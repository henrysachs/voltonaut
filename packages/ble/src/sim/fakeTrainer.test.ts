import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createManualClock } from "./clock.js";
import { createFakeTrainer } from "./fakeTrainer.js";
import { createSimScript } from "./sample.js";
import { createManualTicker } from "./tick.js";

describe("createFakeTrainer", () => {
  it("publishes scripted power and cadence on every tick", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const trainerEvents: DeviceEvent[] = [];
    bus.subscribe("trainer.data", (event) => {
      trainerEvents.push(event);
    });

    const trainer = createFakeTrainer({
      bus,
      clock,
      ticker,
      samples: createSimScript([
        { powerW: 120, cadenceRpm: 85, heartRateBpm: 125, gearIndex: 3 },
        { powerW: 180, cadenceRpm: 95, heartRateBpm: 135, gearIndex: 4 },
      ]),
    });

    await trainer.connect();
    expect(trainer.status()).toBe("ready");

    clock.advanceS(0.25);
    ticker.tick();
    expect(trainerEvents).toEqual([
      { type: "trainer.data", tS: 0.25, powerW: 120, cadenceRpm: 85 },
    ]);

    clock.advanceS(0.25);
    ticker.tick();
    expect(trainerEvents).toEqual([
      { type: "trainer.data", tS: 0.25, powerW: 120, cadenceRpm: 85 },
      { type: "trainer.data", tS: 0.5, powerW: 180, cadenceRpm: 95 },
    ]);
    expect(trainer.gearIndex()).toBe(4);
  });

  it("stops publishing after disconnect", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const trainerEvents: DeviceEvent[] = [];
    const statusEvents: DeviceEvent[] = [];
    bus.subscribe("trainer.data", (event) => {
      trainerEvents.push(event);
    });
    bus.subscribe("device.status", (event) => {
      statusEvents.push(event);
    });

    const trainer = createFakeTrainer({
      bus,
      clock,
      ticker,
      samples: createSimScript([{ powerW: 100, cadenceRpm: 80, heartRateBpm: 120, gearIndex: 0 }]),
    });

    await trainer.connect();
    await trainer.disconnect();
    ticker.tick();

    expect(trainer.status()).toBe("disconnected");
    expect(trainerEvents).toHaveLength(0);
    expect(statusEvents.at(-1)).toMatchObject({ kind: "trainer", status: "disconnected" });
  });
});
