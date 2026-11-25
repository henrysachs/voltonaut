import { createEventBus } from "@voltonaut/shared";
import { bytesToDataView, type ReadOnlyBytes } from "../bytes.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import type { GattWriteMode, GattProperty, NotificationListener } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
} from "../uuids.js";
import { createFtmsControl, type FtmsControlConnection } from "./controlConnection.js";
import type { ControlTransport } from "./controlProcedure.js";

function createWriteBarrier() {
  let release: (() => void) | undefined;

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    promise,
    release: () => {
      release?.();
    },
  };
}

export async function settle(rounds = 20): Promise<void> {
  if (rounds === 0) return;
  await Promise.resolve();
  await settle(rounds - 1);
}

export class ControlTestRig {
  readonly clock = createManualClock();
  readonly ticker = createManualTicker();
  readonly retained: NotificationListener[] = [];
  readonly writes: {
    readonly opcode: number;
    readonly mode: GattWriteMode | undefined;
    readonly bytes: ReadOnlyBytes;
    readonly atS: number;
  }[] = [];
  private readonly listeners = new Map<string, NotificationListener>();
  private autoAck = true;
  private responseResult = 1;
  private writeFailure = false;
  private writeDelay: Promise<void> = Promise.resolve();
  readonly bus = createEventBus();
  readonly control: FtmsControlConnection;

  constructor(clockScale = 1) {
    const transport: ControlTransport = {
      subscribe: (ref, listener) => {
        this.listeners.set(ref.characteristicUuid, listener);
        this.retained.push(listener);

        return Promise.resolve(() => {
          this.listeners.delete(ref.characteristicUuid);
        });
      },
      write: (_ref, bytes, mode) => this.write(bytes, mode),
    };

    this.control = createFtmsControl(
      { clock: this.clock, ticker: this.ticker, clockScale, transport },
      this.bus,
    );
    this.attach();
  }

  private write(bytes: ReadOnlyBytes, mode?: GattWriteMode): Promise<void> {
    if (!this.listeners.has(FITNESS_MACHINE_CONTROL_POINT))
      throw new Error("must subscribe before write");
    const opcode = bytes.at(0) ?? -1;
    this.writes.push({ opcode, mode, bytes, atS: this.clock.nowS() });

    if (this.autoAck) this.notify([0x80, opcode, this.responseResult]);

    return this.writeFailure ? Promise.reject(new Error("write uncertain")) : this.writeDelay;
  }

  attach(properties: readonly GattProperty[] = ["write", "indicate"], simulation = true): void {
    this.control.attach(
      {
        services: [
          {
            uuid: FITNESS_MACHINE_SERVICE,
            characteristics: [
              {
                uuid: FITNESS_MACHINE_CONTROL_POINT,
                properties,
                descriptors: [],
              },
              { uuid: FITNESS_MACHINE_STATUS, properties: ["notify"], descriptors: [] },
            ],
          },
        ],
      },
      {
        machineDwordHex: "0x0",
        machineFeatures: [],
        targetFeatures: simulation ? ["indoorBikeSimulationParameters"] : [],
      },
    );
  }

  /** A parsed trainer sample, as the adapter publishes it. */
  cadence(rpm: number): void {
    this.control.publishData({ type: "trainer.data", tS: this.clock.nowS(), cadenceRpm: rpm });
  }
  notify(bytes: readonly number[]): void {
    this.listeners.get(FITNESS_MACHINE_CONTROL_POINT)?.(bytesToDataView(Uint8Array.from(bytes)));
  }
  ack(enabled: boolean): void {
    this.autoAck = enabled;
  }
  result(value: number): void {
    this.responseResult = value;
  }
  failWrite(): void {
    this.writeFailure = true;
  }
  holdWrites(): () => void {
    const barrier = createWriteBarrier();
    this.writeDelay = barrier.promise;

    return () => {
      barrier.release();
    };
  }
  lost(opcode = 0xff): void {
    this.listeners.get(FITNESS_MACHINE_STATUS)?.(bytesToDataView(Uint8Array.from([opcode])));
  }
  async advance(s: number): Promise<void> {
    this.clock.advanceS(s);
    this.ticker.tick();
    await settle();
  }
}
