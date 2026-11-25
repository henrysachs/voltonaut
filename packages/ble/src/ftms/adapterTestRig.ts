import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import { bytesToDataView, type ReadOnlyBytes } from "../bytes.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import type { BleTransport, GattProfile, NotificationListener } from "../transport.js";
import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  INDOOR_BIKE_DATA,
} from "../uuids.js";
import { createTrainerAdapter, type TrainerAdapter } from "./adapter.js";
import { settle } from "./controlTestRig.js";

const PROFILE: GattProfile = {
  services: [
    {
      uuid: FITNESS_MACHINE_SERVICE,
      characteristics: [
        { uuid: INDOOR_BIKE_DATA, properties: ["notify"], descriptors: [] },
        { uuid: FITNESS_MACHINE_FEATURE, properties: ["read"], descriptors: [] },
        { uuid: FITNESS_MACHINE_CONTROL_POINT, properties: ["write", "indicate"], descriptors: [] },
        { uuid: FITNESS_MACHINE_STATUS, properties: ["notify"], descriptors: [] },
      ],
    },
  ],
};

/** Target-features dword bit 13: Indoor Bike Simulation Parameters supported. */
const FEATURE_BYTES = Uint8Array.of(0, 0, 0, 0, 0, 0x20, 0, 0);

/** FTMS trainer behind the real createTrainerAdapter, with an acknowledging control point. */
export class TrainerAdapterRig {
  readonly clock = createManualClock();
  readonly ticker = createManualTicker();
  readonly bus = createEventBus();
  readonly samples: DeviceEvent[] = [];
  readonly writes: { readonly opcode: number; readonly bytes: ReadOnlyBytes }[] = [];
  readonly adapter: TrainerAdapter;
  private readonly listeners = new Map<string, NotificationListener>();
  private readonly disconnected = new Set<() => void>();
  private autoAck = true;

  constructor(clockScale = 1) {
    const transport: BleTransport = {
      deviceName: () => "FTMS test trainer",
      deviceId: () => "trainer-1",
      connect: () => Promise.resolve(PROFILE),
      read: () => Promise.resolve(bytesToDataView(FEATURE_BYTES)),
      write: (_ref, bytes) => {
        const opcode = bytes.at(0) ?? -1;
        this.writes.push({ opcode, bytes });

        if (this.autoAck) this.indicate([0x80, opcode, 1]);

        return Promise.resolve();
      },
      subscribe: (ref, listener) => {
        this.listeners.set(ref.characteristicUuid, listener);

        return Promise.resolve(() => {
          if (this.listeners.get(ref.characteristicUuid) === listener)
            this.listeners.delete(ref.characteristicUuid);
        });
      },
      watchAdvertisements: () => () => {},
      onDisconnected: (listener) => {
        this.disconnected.add(listener);

        return () => {
          this.disconnected.delete(listener);
        };
      },
      disconnect: () => Promise.resolve(),
    };

    this.adapter = createTrainerAdapter({
      bus: this.bus,
      clock: this.clock,
      ticker: this.ticker,
      clockScale,
      transport,
    });
    this.bus.subscribe("trainer.data", (event) => {
      this.samples.push(event);
    });
  }

  /** Indoor Bike Data without speed (flag bit 0), cadence in 0.5 rpm units and 244 W power. */
  bikeData(cadenceRpm: number): void {
    const raw = Math.round(cadenceRpm * 2);
    this.listeners.get(INDOOR_BIKE_DATA)?.(
      bytesToDataView(Uint8Array.of(0x45, 0, raw & 0xff, raw >> 8, 244, 0)),
    );
  }

  indicate(bytes: readonly number[]): void {
    this.listeners.get(FITNESS_MACHINE_CONTROL_POINT)?.(bytesToDataView(Uint8Array.from(bytes)));
  }

  ack(enabled: boolean): void {
    this.autoAck = enabled;
  }

  dropLink(): void {
    for (const listener of this.disconnected) listener();
  }

  simWrites(): readonly number[] {
    return this.writes
      .filter((write) => write.opcode === 0x11)
      .map((write) => (write.bytes.at(3) ?? 0) | ((write.bytes.at(4) ?? 0) << 8));
  }

  async advance(s: number): Promise<void> {
    this.clock.advanceS(s);
    this.ticker.tick();
    await settle();
  }
}
