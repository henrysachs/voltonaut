import { expect, it } from "vitest";

import { DEFAULT_RIDER_PARAMS } from "../physics/params.js";
import { GEAR_RATIOS, START_GEAR_INDEX } from "../gears/presets.js";
import { FLAT_LOOP } from "../elevation/data/flat-loop.js";
import { KOM_CLIMB } from "../elevation/data/kom-climb.js";
import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute } from "../elevation/route.js";
import type { EngineContext } from "./tick.js";
import { tick } from "./tick.js";
import { createRideState, type RideState } from "./state.js";
import type { RideEvent, TickInputs } from "@voltonaut/shared";

const FLAT = createRoute(FLAT_LOOP);
const TEST = createRoute(TEST_LOOP);
const KOM = createRoute(KOM_CLIMB);

function context(route = FLAT): EngineContext {
  return {
    route,
    riderParams: DEFAULT_RIDER_PARAMS,
    gearRatios: GEAR_RATIOS,
    physicalRatio: 3,
    trainerMassKg: 83,
  };
}

function state(routePosM = 0, speedMps = 0): RideState {
  return createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps,
    routePosM,
  });
}

function inputs(overrides: Partial<TickInputs> = {}): TickInputs {
  return {
    powerW: 200,
    cadenceRpm: 90,
    hrBpm: undefined,
    shifts: 0,
    trainerDataFresh: true,
    ...overrides,
  };
}

it("integrates one hand-computed 200 W tick from standstill", () => {
  const result = tick(state(), inputs(), context(), 0.05);
  const s = result.state;

  // Propulsive force is floored at 0.5 m/s: 194 / 0.5 = 388 N,
  // rolling resistance 83 * 9.81 * 0.004 ~ 3.2569 N, m_eff = 84 kg.
  // v = 0.05 * (388 - 3.2569) / 84 ~ 0.229013 m/s.
  expect(s.speedMps).toBeCloseTo(0.2290137, 5);
  expect(s.tS).toBeCloseTo(0.05, 10);
  expect(s.distanceM).toBeCloseTo(0.0114507, 6);
  expect(s.energyKj).toBeCloseTo(0.01, 12);
  expect(s.gradePct).toBe(0);
  expect(s.elevationGainM).toBe(0);
  expect(result.trainerCommand?.type).toBe("simulation");
});

it("smooths display values with the 1 s EMA while energy uses raw power", () => {
  const alpha = 1 - Math.exp(-0.05);
  let s = state();

  s = tick(s, inputs({ powerW: 200, hrBpm: 130 }), context(), 0.05).state;

  expect(s.powerW).toBeCloseTo(alpha * 200, 8);
  expect(s.hrBpm).toBe(130);

  s = tick(s, inputs({ powerW: 200, hrBpm: 140 }), context(), 0.05).state;

  expect(s.powerW).toBeCloseTo(alpha * 200 + alpha * (200 - alpha * 200), 8);
  expect(s.hrBpm).toBeCloseTo(130 + alpha * 10, 8);
  expect(s.energyKj).toBeCloseTo(0.02, 12);
});

it("applies shift intents, emits gear.changed and commands immediately", () => {
  const first = tick(state(), inputs(), context(), 0.05);
  const shifted = tick(first.state, inputs({ shifts: 2 }), context(), 0.05);

  expect(shifted.state.gearIndex).toBe(START_GEAR_INDEX + 2);
  expect(shifted.state.gearRatio).toBeCloseTo(2.82, 10);
  expect(shifted.events).toContainEqual({
    type: "gear.changed",
    from: START_GEAR_INDEX,
    to: START_GEAR_INDEX + 2,
  });
  expect(first.trainerCommand).toBeDefined();
  expect(shifted.trainerCommand).toBeDefined();
});

it("clamps shifts into [1, 24] and only emits on real changes", () => {
  const bottom = tick(state(), inputs({ shifts: -50 }), context(), 0.05);

  expect(bottom.state.gearIndex).toBe(0);
  expect(bottom.events.filter((event) => event.type === "gear.changed")).toHaveLength(1);

  const top = tick(bottom.state, inputs({ shifts: 50 }), context(), 0.05);

  expect(top.state.gearIndex).toBe(23);
  expect(top.events.filter((event) => event.type === "gear.changed")).toHaveLength(1);
});

it("wraps the lap and emits lap.completed", () => {
  const rolling = state(4999.9, 8);
  const result = tick(rolling, inputs(), context(), 0.05);
  const s = result.state;

  expect(s.distanceM).toBeGreaterThan(5000);
  expect(s.routePosM).toBeLessThan(1);
  expect(s.lap).toBe(1);
  expect(result.events).toContainEqual({ type: "lap.completed", lap: 1, tS: s.tS });
});

it("enters and exits segments exactly at the test-loop boundaries", () => {
  let s = state(1999.9, 8);

  const entered = tick(s, inputs(), context(TEST), 0.05);

  expect(entered.state.activeSegments).toEqual(["sprint-1"]);
  expect(entered.events).toContainEqual({
    type: "segment.entered",
    segmentId: "sprint-1",
    tS: entered.state.tS,
  });

  s = entered.state;

  const exited: RideEvent[] = [];

  // ~500 m from the sprint start at ~8 m/s => 1300 ticks (65 s) is plenty.
  for (let i = 0; i < 1300; i += 1) {
    const result = tick(s, inputs(), context(TEST), 0.05);

    s = result.state;
    exited.push(...result.events);
  }

  expect(s.activeSegments).toEqual([]);

  const exitEvent = exited.find((event) => event.type === "segment.exited");

  expect(exitEvent).toMatchObject({ type: "segment.exited", segmentId: "sprint-1" });
});

it("clamps at the end of a non-loop route without lap events", () => {
  let s = state(2499.9, 8);

  const events: RideEvent[] = [];

  for (let i = 0; i < 40; i += 1) {
    const result = tick(s, inputs(), context(KOM), 0.05);

    s = result.state;
    events.push(...result.events);
  }

  expect(s.routePosM).toBe(2500);
  expect(s.distanceM).toBeGreaterThan(2500);
  expect(events.filter((event) => event.type === "lap.completed")).toHaveLength(0);
});
