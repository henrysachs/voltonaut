import type { DeviceAdapter, EventBus } from "@voltonaut/shared";

import type { SimClock } from "./clock.js";
import type { SimScript } from "./sample.js";
import type { TickSource } from "./tick.js";

export interface FakeHeartRateOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly samples: SimScript;
  readonly id?: string;
}

export interface FakeHeartRate extends DeviceAdapter {}

export function createFakeHeartRate(options: FakeHeartRateOptions): FakeHeartRate {
  const { bus, clock, ticker, samples } = options;
  const id = options.id ?? "sim-heart-rate";
  let status: "disconnected" | "ready" = "disconnected";
  let stopTick: (() => void) | undefined;
  let sampleIndex = 0;

  const publishStatus = (nextStatus: "disconnected" | "ready"): void => {
    status = nextStatus;
    bus.publish({ type: "device.status", tS: clock.nowS(), kind: "heartRate", id, status });
  };

  return {
    kind: "heartRate",
    id,
    connect() {
      publishStatus("ready");
      stopTick = ticker.start(() => {
        const sample = samples[sampleIndex] ?? samples[0];
        sampleIndex = (sampleIndex + 1) % samples.length;
        bus.publish({ type: "hr.data", tS: clock.nowS(), bpm: sample.heartRateBpm });
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
  };
}
