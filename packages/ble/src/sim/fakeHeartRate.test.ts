import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { beforeAll, describe, expect, it } from "vitest";

import { createManualClock } from "./clock.js";
import { createFakeHeartRate } from "./fakeHeartRate.js";
import { createSimScript } from "./sample.js";
import { createManualTicker } from "./tick.js";

describe("createFakeHeartRate", () => {
  let bus: ReturnType<typeof createEventBus>;
  let clock: ReturnType<typeof createManualClock>;
  let ticker: ReturnType<typeof createManualTicker>;
  let events: DeviceEvent[];

  beforeAll(() => {
    bus = createEventBus();
    clock = createManualClock();
    ticker = createManualTicker();
    events = [];
    bus.subscribe("hr.data", (event) => {
      events.push(event);
    });
  });

  it("publishes the scripted heart rate on every tick", async () => {
    const heartRate = createFakeHeartRate({
      bus,
      clock,
      ticker,
      samples: createSimScript([
        { powerW: 100, cadenceRpm: 80, heartRateBpm: 120, gearIndex: 0 },
        { powerW: 110, cadenceRpm: 82, heartRateBpm: 128, gearIndex: 0 },
      ]),
    });

    await heartRate.connect();
    ticker.tick();
    ticker.tick();

    expect(events).toEqual([
      { type: "hr.data", tS: 0, bpm: 120 },
      { type: "hr.data", tS: 0, bpm: 128 },
    ]);
  });
});
