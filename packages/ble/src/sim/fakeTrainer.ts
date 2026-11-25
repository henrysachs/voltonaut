import type { DeviceAdapter, EventBus } from "@voltonaut/shared";

import type { SimClock } from "./clock.js";
import type { SimScript } from "./sample.js";
import type { TickSource } from "./tick.js";
import { createSimTrainerControl } from "../ftms/controlSim.js";
import type { TrainerControl } from "../ftms/control.js";

export interface FakeTrainerOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly samples: SimScript;
  /** Ride clock scale, fixed for the trainer's lifetime; control requires exactly 1. */
  readonly clockScale: number;
  readonly id?: string;
}

export interface FakeTrainer extends DeviceAdapter {
  readonly control: TrainerControl;
  gearIndex(): number;
}

export function createFakeTrainer(options: FakeTrainerOptions): FakeTrainer {
  const { bus, clock, ticker, samples, clockScale } = options;
  const id = options.id ?? "sim-trainer";
  const simulation = createSimTrainerControl({ clock, ticker, clockScale }, bus);
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
    control: simulation.control,
    connect() {
      simulation.connect();
      publishStatus("ready");
      stopTick = ticker.start(() => {
        const sample = samples[sampleIndex] ?? samples[0];
        sampleIndex = (sampleIndex + 1) % samples.length;
        gearIndex = sample.gearIndex;
        simulation.control.publishData({
          type: "trainer.data",
          tS: clock.nowS(),
          powerW: sample.powerW,
          cadenceRpm: sample.cadenceRpm,
        });
      });

      return Promise.resolve();
    },
    disconnect() {
      simulation.control.detach();
      stopTick?.();
      stopTick = undefined;
      publishStatus("disconnected");

      return Promise.resolve();
    },
    status: () => status,
    gearIndex: () => gearIndex,
  };
}
