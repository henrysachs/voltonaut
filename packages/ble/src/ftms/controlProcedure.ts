import { parseControlResponse, type ControlResult } from "./controlCodec.js";
import type { ByteReader, ReadOnlyBytes } from "../bytes.js";
import type { SimClock } from "../sim/clock.js";
import type { TickSource, Unsubscribe } from "../sim/tick.js";
import type { BleTransport } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
} from "../uuids.js";

export type ControlTransport = Readonly<Pick<BleTransport, "write" | "subscribe">>;

interface PendingProcedure {
  readonly opcode: number | "subscribe";
  readonly deadlineS: number;
  readonly resolve: (success: boolean) => void;
  writeComplete: boolean;
  acknowledged: boolean;
}

const CONTROL_POINT = {
  serviceUuid: FITNESS_MACHINE_SERVICE,
  characteristicUuid: FITNESS_MACHINE_CONTROL_POINT,
};

const START_OR_RESUME = 0x07;

/**
 * A Zwift Hub answered `80 07 04` (Operation Failed) to a second Start on the same
 * connection, apparently because it already ran. It is a definite answer to our own write,
 * so acquisition goes on; the following neutral 0x11 still needs "success". qdomyos-zwift
 * and Incyclist also treat the Start result as non-fatal.
 */
// UNVERIFIED: docs/02-bluetooth.md#zwift-hub-one – the FTMS v1.0 section for this case is not checked here.
function acknowledges(opcode: number | "subscribe", result: ControlResult): boolean {
  return result === "success" || (opcode === START_OR_RESUME && result === "failed");
}

/** One procedure includes both the native write completion and its exact indication. */
export class ControlProcedure {
  private usable = true;
  private pending: PendingProcedure | undefined;
  private readonly stops: Unsubscribe[] = [];

  constructor(
    private readonly transport: ControlTransport,
    private readonly clock: SimClock,
    ticker: TickSource,
    private readonly failure: (reason: string, lost: boolean) => void,
  ) {
    this.stops.push(
      ticker.start(() => {
        const nowS = clock.nowS();

        if (
          this.pending !== undefined &&
          (!Number.isFinite(nowS) || nowS >= this.pending.deadlineS)
        ) {
          this.fail("FTMS-Antwort/Write unbestätigt. Neu verbinden; Widerstand unbekannt.");
        }
      }),
    );
  }

  private fail(reason: string, lost = false): void {
    if (!this.usable) return;
    this.dispose();
    this.failure(reason, lost);
  }

  dispose(): void {
    this.usable = false;
    const pending = this.pending;
    this.pending = undefined;
    pending?.resolve(false);

    for (const stop of this.stops.splice(0)) stop();
  }

  private complete(): void {
    const pending = this.pending;

    if (pending !== undefined && this.clock.nowS() >= pending.deadlineS) {
      this.fail("FTMS-Antwort nach Frist. Neu verbinden; Widerstand unbekannt.");

      return;
    }

    if (pending?.writeComplete === true && pending.acknowledged) {
      this.pending = undefined;
      pending.resolve(true);
    }
  }

  private response(data: ByteReader): void {
    if (!this.usable) return;

    if (this.pending !== undefined && this.clock.nowS() >= this.pending.deadlineS) {
      this.fail("Verspätete FTMS-Antwort. Neu verbinden; Widerstand unbekannt.");

      return;
    }

    const response = parseControlResponse(data);

    if (!response.ok) {
      this.fail("Ungültige FTMS-Antwort. Neu verbinden; Widerstand unbekannt.");

      return;
    }

    if (response.value.result === "notPermitted") {
      this.fail(
        "Trainer verweigert Steuerrechte. Andere Apps/Uhr trennen und neu verbinden.",
        true,
      );

      return;
    }

    const pending = this.pending;

    if (pending === undefined || pending.opcode !== response.value.opcode) return;

    if (!acknowledges(pending.opcode, response.value.result)) {
      this.fail(
        `Trainer meldet ${response.value.result}. Messwerte bleiben verfügbar; neu verbinden.`,
      );

      return;
    }

    pending.acknowledged = true;
    this.complete();
  }

  private begin(opcode: number | "subscribe", start: () => Promise<void>): Promise<boolean> {
    if (!this.usable || this.pending !== undefined) {
      return Promise.resolve(false);
    }

    if (!Number.isFinite(this.clock.nowS() + 3)) {
      this.fail("Ungültige FTMS-Uhr. Neu verbinden.");

      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      const pending: PendingProcedure = {
        opcode,
        deadlineS: this.clock.nowS() + 3,
        resolve,
        writeComplete: false,
        acknowledged: opcode === "subscribe",
      };

      this.pending = pending;
      // Pending is installed before invoking native I/O: indications may arrive synchronously.
      void Promise.resolve()
        .then(() => (this.usable && this.pending === pending ? start() : Promise.resolve()))
        .then(() => {
          if (this.pending === pending && this.usable) {
            pending.writeComplete = true;
            this.complete();
          }

          return true;
        })
        .catch(() => {
          this.fail("FTMS-Übertragung unbestätigt. Neu verbinden; Widerstand unbekannt.");
        });
    });
  }

  private async subscribe(
    characteristicUuid: string,
    receive: (data: ByteReader) => void,
  ): Promise<void> {
    const stop = await this.transport.subscribe(
      { serviceUuid: FITNESS_MACHINE_SERVICE, characteristicUuid },
      receive,
    );

    if (this.usable) this.stops.push(stop);
    else stop();
  }

  open(statusNotifications: boolean): Promise<boolean> {
    return this.begin("subscribe", async () => {
      await this.subscribe(FITNESS_MACHINE_CONTROL_POINT, (data) => {
        this.response(data);
      });

      if (this.usable && statusNotifications) {
        await this.subscribe(FITNESS_MACHINE_STATUS, (data) => {
          if (!this.usable || data.byteLength === 0) return;
          const opcode = data.getUint8(0);

          if (opcode === 0xff || opcode === 0x01) {
            this.fail(
              opcode === 0xff
                ? "Trainer-Steuerrechte verloren. Neu verbinden."
                : "Trainer wurde zurückgesetzt. Neu verbinden.",
              true,
            );
          }
        });
      }
    });
  }

  run(opcode: number, bytes: ReadOnlyBytes): Promise<boolean> {
    return this.begin(opcode, () => this.transport.write(CONTROL_POINT, bytes, "withResponse"));
  }
}
