import type { DeviceEvent } from "@voltonaut/shared";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createManualClock } from "./clock.js";
import { createFakeTrainer } from "./fakeTrainer.js";
import type { FakeTrainer } from "./fakeTrainer.js";
import { createSimScript, type SimScript } from "./sample.js";
import { createManualTicker } from "./tick.js";

interface TrainerHarness {
  readonly trainer: FakeTrainer;
  readonly advanceS: (deltaS: number) => void;
  readonly tick: () => void;
  readonly trainerEvents: DeviceEvent[];
  readonly statusEvents: DeviceEvent[];
}

function createTrainerHarness(samples: SimScript): TrainerHarness {
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

  const trainer = createFakeTrainer({ bus, clock, ticker, clockScale: 1, samples });

  return {
    trainer,
    advanceS: (deltaS: number): void => {
      clock.advanceS(deltaS);
    },
    tick: (): void => {
      ticker.tick();
    },
    trainerEvents,
    statusEvents,
  };
}

describe("createFakeTrainer", () => {
  it("publishes scripted power and cadence on every tick", async () => {
    const harness = createTrainerHarness(
      createSimScript([
        { powerW: 120, cadenceRpm: 85, heartRateBpm: 125, gearIndex: 3 },
        { powerW: 180, cadenceRpm: 95, heartRateBpm: 135, gearIndex: 4 },
      ]),
    );

    await harness.trainer.connect();
    expect(harness.trainer.status()).toBe("ready");

    harness.advanceS(0.25);
    harness.tick();
    expect(harness.trainerEvents).toEqual([
      { type: "trainer.data", tS: 0.25, powerW: 120, cadenceRpm: 85 },
    ]);

    harness.advanceS(0.25);
    harness.tick();
    expect(harness.trainerEvents).toEqual([
      { type: "trainer.data", tS: 0.25, powerW: 120, cadenceRpm: 85 },
      { type: "trainer.data", tS: 0.5, powerW: 180, cadenceRpm: 95 },
    ]);
    expect(harness.trainer.gearIndex()).toBe(4);
  });

  it("stops publishing after disconnect", async () => {
    const harness = createTrainerHarness(
      createSimScript([{ powerW: 100, cadenceRpm: 80, heartRateBpm: 120, gearIndex: 0 }]),
    );

    await harness.trainer.connect();
    await harness.trainer.disconnect();
    harness.tick();

    expect(harness.trainer.status()).toBe("disconnected");
    expect(harness.trainerEvents).toHaveLength(0);
    expect(harness.statusEvents.at(-1)).toMatchObject({ kind: "trainer", status: "disconnected" });
  });
});
