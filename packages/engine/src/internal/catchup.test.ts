import { describe, expect, it } from "vitest";

import type { RideEvent } from "@voltonaut/shared";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import { FLAT_LOOP } from "../elevation/data/flat-loop.js";
import { createRoute } from "../elevation/route.js";
import { MAX_CATCHUP_TICKS, planCatchup, TICK_S } from "./catchup.js";
import { createEngine } from "./engine.js";

describe("planCatchup", () => {
  it("uses a fixed 0.05 s tick and a 120 tick cap", () => {
    expect(TICK_S).toBe(0.05);
    expect(MAX_CATCHUP_TICKS).toBe(120);
    expect(MAX_CATCHUP_TICKS * TICK_S).toBeCloseTo(6, 10);
  });

  it("runs one tick per 0.05 s and keeps the fraction", () => {
    expect(planCatchup(0.05)).toEqual({ ticksToRun: 1, skippedS: 0 });
    expect(planCatchup(1)).toEqual({ ticksToRun: 20, skippedS: 0 });
    expect(planCatchup(0.049)).toEqual({ ticksToRun: 0, skippedS: 0 });
    expect(planCatchup(6)).toEqual({ ticksToRun: 120, skippedS: 0 });
  });

  it("caps at 120 ticks and reports the skipped remainder", () => {
    // 6.5 s gap: floor(6.5 / 0.05) = 130 ticks, 10 beyond the cap.
    const capped = planCatchup(6.5);

    expect(capped.ticksToRun).toBe(120);
    expect(capped.skippedS).toBeCloseTo(0.5, 10);
    expect(planCatchup(60)).toEqual({ ticksToRun: 120, skippedS: 54 });
  });

  it("ignores non-positive and non-finite elapsed time", () => {
    expect(planCatchup(0)).toEqual({ ticksToRun: 0, skippedS: 0 });
    expect(planCatchup(-1)).toEqual({ ticksToRun: 0, skippedS: 0 });
    expect(planCatchup(Number.NaN)).toEqual({ ticksToRun: 0, skippedS: 0 });
  });
});

function makeEngine(initialSpeedMps = 0) {
  return createEngine({
    route: createRoute(FLAT_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
    initialSpeedMps,
  });
}

describe("engine catch-up integration", () => {
  it("advances exactly 20 ticks per simulated second", () => {
    const engine = makeEngine();

    engine.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });
    engine.advance(1);
    engine.advance(1);

    expect(engine.snapshot().tS).toBeCloseTo(2, 9);
  });

  it("carries sub-tick fractions forward", () => {
    const engine = makeEngine();

    engine.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });
    engine.advance(0.04);
    engine.advance(0.04);
    engine.advance(0.04);

    // 0.12 s accumulated => 2 ticks, 0.02 s still pending.
    expect(engine.snapshot().tS).toBeCloseTo(0.1, 10);
  });
});

describe("engine clock gaps", () => {
  it("emits ride.started once and ride.clockSkipped only on gaps beyond 6 s", () => {
    const engine = makeEngine();

    engine.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });
    engine.advance(1);
    engine.advance(60);

    const events = engine.drainEvents();
    const startedEvents = events.filter((event: RideEvent) => event.type === "ride.started");
    const skippedEvents = events.filter((event: RideEvent) => event.type === "ride.clockSkipped");

    expect(startedEvents).toHaveLength(1);
    expect(skippedEvents).toEqual([{ type: "ride.clockSkipped", skippedS: 54 }]);
    expect(engine.snapshot().tS).toBeCloseTo(7, 9);
  });

  it("rolls out instead of standing still after a skipped gap", () => {
    const engine = makeEngine(9.4);

    engine.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });
    engine.advance(0.05);
    engine.advance(60);

    // 120 ticks without fresh data: power reads as zero from second 3 on,
    // the rider keeps rolling (data-loss rule) instead of freezing.
    const snapshot = engine.snapshot();

    expect(snapshot.dataAgeS).toBeGreaterThan(3);
    expect(snapshot.speedMps).toBeGreaterThan(0);
    expect(snapshot.paused).toBe(false);
  });
});
