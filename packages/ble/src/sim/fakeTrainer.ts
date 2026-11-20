import type { DeviceAdapter, EventBus } from "@voltonaut/shared";

import type { SimClock } from "./clock.js";
import type { SimScript } from "./sample.js";
import type { TickSource } from "./tick.js";

export interface FakeTrainerOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly samples: SimScript;
  readonly id?: string;
}

export interface FakeTrainer extends DeviceAdapter {
  gearIndex(): number;
}

export function createFakeTrainer(options: FakeTrainerOptions): FakeTrainer {
  const { bus, clock, ticker, samples } = options;
  const id = options.id ?? "sim-trainer";
  let status: "disconnected" | "ready" = "disconnected";
  let stopTick: (() => void) | undefined;
  let sampleIndex = 0;
  let gearIndex = samples[0].gearIndex;

  const publishStatus = (nextStatus: "disconnected" | "ready"): void => {
    status = nextStatus;
    bus.publish({ type: "device.status", tS: clock.nowS(), kind: "trainer", id, status });
  };

  return {
    kind: "trainer",
    id,
    connect() {
      publishStatus("ready");
      stopTick = ticker.start(() => {
        const sample = samples[sampleIndex] ?? samples[0];
        sampleIndex = (sampleIndex + 1) % samples.length;
        gearIndex = sample.gearIndex;
        bus.publish({
          type: "trainer.data",
          tS: clock.nowS(),
          powerW: sample.powerW,
          cadenceRpm: sample.cadenceRpm,
        });
      });

      return Promise.resolve();
    },
    disconnect() {
      stopTick?.();
      stopTick = undefined;
      publishStatus("disconnected");

      return Promise.resolve();
    },
    status: () => status,
    gearIndex: () => gearIndex,
  };
}
