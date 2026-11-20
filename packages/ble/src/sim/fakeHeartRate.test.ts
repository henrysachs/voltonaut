import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createManualClock } from "./clock.js";
import { createFakeHeartRate } from "./fakeHeartRate.js";
import type { FakeHeartRate } from "./fakeHeartRate.js";
import { createSimScript, type SimScript } from "./sample.js";
import { createManualTicker } from "./tick.js";

interface HeartRateHarness {
  readonly heartRate: FakeHeartRate;
  readonly tick: () => void;
  readonly events: DeviceEvent[];
}

function createHeartRateHarness(samples: SimScript): HeartRateHarness {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const events: DeviceEvent[] = [];

  bus.subscribe("hr.data", (event) => {
    events.push(event);
  });

  const heartRate = createFakeHeartRate({ bus, clock, ticker, samples });

  return {
    heartRate,
    tick: (): void => {
      ticker.tick();
    },
    events,
  };
}

describe("createFakeHeartRate", () => {
  it("publishes the scripted heart rate on every tick", async () => {
    const harness = createHeartRateHarness(
      createSimScript([
        { powerW: 100, cadenceRpm: 80, heartRateBpm: 120, gearIndex: 0 },
        { powerW: 110, cadenceRpm: 82, heartRateBpm: 128, gearIndex: 0 },
      ]),
    );

    await harness.heartRate.connect();
    harness.tick();
    harness.tick();

    expect(harness.events).toEqual([
      { type: "hr.data", tS: 0, bpm: 120 },
      { type: "hr.data", tS: 0, bpm: 128 },
    ]);
  });

  it("stops publishing after disconnect", async () => {
    const harness = createHeartRateHarness(
      createSimScript([{ powerW: 100, cadenceRpm: 80, heartRateBpm: 120, gearIndex: 0 }]),
    );

    await harness.heartRate.connect();
    await harness.heartRate.disconnect();
    harness.tick();

    expect(harness.events).toHaveLength(0);
    expect(harness.heartRate.status()).toBe("disconnected");
  });
});
