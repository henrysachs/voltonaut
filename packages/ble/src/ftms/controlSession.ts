import { readOnlyBytes } from "../bytes.js";
import type { Unsubscribe } from "../sim/tick.js";
import {
  encodeSimulation,
  NEUTRAL_SIMULATION,
  type EncodedSimulation,
  type SimulationCommand,
} from "./controlCodec.js";
import { ControlProcedure } from "./controlProcedure.js";
import {
  SIM_INTERVAL_S,
  FRESH_S,
  type ControlOptions,
  type TrainerAuthority,
  type TrainerControlView,
} from "./controlState.js";

function sameCommand(left: SimulationCommand, right: SimulationCommand): boolean {
  return (
    left.gradePct === right.gradePct &&
    left.windMps === right.windMps &&
    left.crr === right.crr &&
    left.cwKgPerM === right.cwKgPerM
  );
}

// UNVERIFIED: docs/02-bluetooth.md#e2-03-rollenschaltung – firmware/physical feel still require hardware acceptance.
export class FtmsControlSession {
  private authority: TrainerAuthority = {
    kind: "inactive",
    reason: "Nur Messwerte. Rollenschaltung ausdrücklich aktivieren.",
  };
  private target: SimulationCommand | undefined;
  private acknowledged: SimulationCommand | undefined;
  private hardware: TrainerControlView["hardware"] = "unknown";
  private latest: { readonly encoded: EncodedSimulation; readonly tS: number } | undefined;
  private cadence: { readonly rpm: number; readonly tS: number } | undefined;
  private nextSimS = -Infinity;
  private procedure: ControlProcedure | undefined;
  private busy = false;
  private alive = true;
  private rateWaiter: ((ready: boolean) => void) | undefined;
  private readonly stopTick: Unsubscribe;

  constructor(
    private readonly options: ControlOptions,
    private readonly statusNotifications: boolean,
    private readonly changed: () => void,
  ) {
    this.stopTick = options.ticker.start(() => {
      if (this.rateWaiter !== undefined && options.clock.nowS() >= this.nextSimS) {
        const resolve = this.rateWaiter;
        this.rateWaiter = undefined;
        resolve(true);
      }

      this.flush();
    });
  }

  view(): TrainerControlView {
    return {
      authority: this.authority,
      available: this.alive,
      target: this.target,
      acknowledged: this.acknowledged,
      hardware: this.hardware,
    };
  }

  private publish(authority: TrainerAuthority): void {
    this.authority = authority;
    this.changed();
  }

  private fail(reason: string, lost: boolean): void {
    if (!this.alive) return;
    this.dispose();
    this.target = undefined;
    this.hardware = "unknown";
    this.publish(
      lost ? { kind: "lost", reason } : { kind: "failed", reason, reconnectRequired: true },
    );
  }

  dispose(): void {
    this.alive = false;
    this.latest = undefined;
    this.procedure?.dispose();
    this.rateWaiter?.(false);
    this.rateWaiter = undefined;
    this.stopTick();
  }

  observeCadence(rpm: number): void {
    this.cadence =
      Number.isFinite(rpm) && rpm > 0 ? { rpm, tS: this.options.clock.nowS() } : undefined;

    if (this.cadence === undefined) this.latest = undefined;
  }

  private fresh(tS: number): boolean {
    const ageS = this.options.clock.nowS() - tS;

    return Number.isFinite(ageS) && ageS >= 0 && ageS <= FRESH_S;
  }

  submit(command: SimulationCommand): void {
    if (
      !this.alive ||
      (this.authority.kind !== "active" && this.authority.kind !== "acquiring") ||
      (this.authority.kind === "acquiring" && this.authority.step === "stopping")
    )
      return;

    if (this.cadence === undefined || !this.fresh(this.cadence.tS)) return;
    const encoded = encodeSimulation(command);

    if (!encoded.ok) return;
    const previous = this.target;

    if (previous !== undefined && sameCommand(previous, encoded.value.command)) {
      if (this.latest !== undefined)
        this.latest = { encoded: encoded.value, tS: this.options.clock.nowS() };

      if (
        this.latest !== undefined ||
        this.busy ||
        (this.acknowledged !== undefined && sameCommand(this.acknowledged, previous))
      )
        return;
    }

    this.target = encoded.value.command;
    this.latest = { encoded: encoded.value, tS: this.options.clock.nowS() };
    this.changed();
    this.flush();
  }

  private flush(): void {
    const latest = this.latest;

    if (
      !this.alive ||
      this.authority.kind !== "active" ||
      this.busy ||
      latest === undefined ||
      this.options.clock.nowS() < this.nextSimS
    )
      return;
    this.latest = undefined;

    if (!this.fresh(latest.tS) || this.cadence === undefined || !this.fresh(this.cadence.tS))
      return;
    const procedure = this.procedure;

    if (procedure === undefined) return;
    this.busy = true;
    this.nextSimS = this.options.clock.nowS() + SIM_INTERVAL_S;
    void procedure.run(0x11, latest.encoded.bytes).then((success) => {
      if (success && this.alive) {
        this.acknowledged = latest.encoded.command;
        this.hardware = "targetAcknowledged";
        this.changed();
      }

      this.busy = false;
      this.flush();

      return success;
    });
  }

  private async neutralize(): Promise<boolean> {
    const procedure = this.procedure;

    if (procedure === undefined) return false;
    this.nextSimS = this.options.clock.nowS() + SIM_INTERVAL_S;
    const success = await procedure.run(0x11, NEUTRAL_SIMULATION.bytes);

    if (success && this.alive) {
      this.acknowledged = NEUTRAL_SIMULATION.command;
      this.hardware = "neutralAcknowledged";
      this.changed();
    }

    return success && this.alive;
  }

  async enable(clockScale: number): Promise<void> {
    if (!this.alive || this.authority.kind !== "inactive") return;

    if (clockScale !== 1) {
      this.publish({
        kind: "failed",
        reason: "Rollenschaltung benötigt Echtzeit (clockScale=1). Neu laden ohne clock=fast.",
        reconnectRequired: false,
      });

      return;
    }

    this.latest = undefined;
    this.target = undefined;
    this.cadence = undefined;
    this.publish({ kind: "acquiring", step: "control" });

    const procedure = new ControlProcedure(
      this.options.transport,
      this.options.clock,
      this.options.ticker,
      (reason, lost) => {
        this.fail(reason, lost);
      },
    );

    this.procedure = procedure;

    const subscribed = await procedure.open(this.statusNotifications);

    if (!subscribed || !this.alive) return;

    const granted = await procedure.run(0, readOnlyBytes(Uint8Array.of(0)));

    if (!granted || !this.alive) return;
    this.publish({ kind: "acquiring", step: "start" });

    const started = await procedure.run(7, readOnlyBytes(Uint8Array.of(7)));

    if (!started || !this.alive) return;
    this.publish({ kind: "acquiring", step: "neutral" });
    const neutralized = await this.neutralize();

    if (!neutralized || !this.alive) return;
    this.publish({ kind: "active" });
    this.flush();
  }

  async disable(): Promise<void> {
    this.latest = undefined;
    this.target = undefined;

    if (this.authority.kind !== "active" || this.busy) {
      if (this.authority.kind === "acquiring" || this.busy) {
        this.procedure?.dispose();
        this.fail(
          "Deaktiviert während ausstehendem Verfahren. Widerstand unbekannt; neu verbinden.",
          false,
        );
      }

      return;
    }

    const procedure = this.procedure;

    if (procedure === undefined) return;
    this.publish({ kind: "acquiring", step: "stopping" });

    // Stop/Pause (0x08, 1) is standard; no Reset and no writes after lost ownership.
    // At most the remainder of the current 250-ms slot; no additional regular command delay.
    const ready =
      this.options.clock.nowS() >= this.nextSimS ||
      (await new Promise<boolean>((resolve) => {
        this.rateWaiter = resolve;
      }));

    if (!ready || !this.alive) return;
    const neutralized = await this.neutralize();

    if (!neutralized || !this.alive) return;

    const stopped = await procedure.run(8, readOnlyBytes(Uint8Array.of(8, 1)));

    if (!stopped || !this.alive) return;
    this.hardware = "stopAcknowledged";
    procedure.dispose();
    this.publish({
      kind: "inactive",
      reason:
        "Stop vom Trainer bestätigt; keine Aussage über physischen Stillstand. Erneute Freigabe erfordert Neuverbindung.",
    });
    // A fresh GATT session is required rather than correlating late duplicate 0x11 replies.
    this.alive = false;
    this.stopTick();
    this.changed();
  }
}
