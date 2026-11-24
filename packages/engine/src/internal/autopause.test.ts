import { describe, expect, it } from "vitest";

import { GEAR_RATIOS, START_GEAR_INDEX } from "../gears/presets.js";
import { FLAT_LOOP } from "../elevation/data/flat-loop.js";
import { createRoute } from "../elevation/route.js";
import type { EngineContext } from "./tick.js";
import { tick } from "./tick.js";
import { createRideState, type RideState } from "./state.js";
import type { TickInputs } from "@voltonaut/shared";

const FLAT_ROUTE = createRoute(FLAT_LOOP);

function makeContext(): EngineContext {
  return {
    route: FLAT_ROUTE,
    riderParams: {
      massKg: 75,
      bikeMassKg: 8,
      cdaM2: 0.32,
      crr: 0.004,
      wheelCircM: 2.105,
    },
    gearRatios: GEAR_RATIOS,
    physicalRatio: 3,
    trainerMassKg: 83,
  };
}

function makeState(speedMps = 0): RideState {
  return createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps,
    routePosM: 0,
  });
}

function inputs(overrides: Partial<TickInputs> = {}): TickInputs {
  return {
    powerW: 0,
    cadenceRpm: 0,
    hrBpm: undefined,
    shifts: 0,
    trainerDataFresh: true,
    useItem: false,
    mode: "normal",
    ...overrides,
  };
}

function runTicks(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state threaded through the tick.
  state: RideState,
  count: number,
  tickInputs: TickInputs,
): RideState {
  let current = state;

  for (let tickNumber = 0; tickNumber < count; tickNumber += 1) {
    current = tick(current, tickInputs, makeContext(), 0.05).state;
  }

  return current;
}

describe("auto-pause rule (100 standing ticks => pause exactly at tick 101)", () => {
  it("stays unpaused for the first 100 stationary ticks", () => {
    const state = runTicks(makeState(), 100, inputs());

    expect(state.paused).toBe(false);
    expect(state.tS).toBeCloseTo(5, 10);
    expect(state.stationaryS).toBeCloseTo(5, 10);
  });

  it("pauses on tick 101 and freezes the sums from that tick on", () => {
    const standing = inputs();
    let state = runTicks(makeState(), 100, standing);

    state = tick(state, standing, makeContext(), 0.05).state;

    expect(state.paused).toBe(true);
    expect(state.tS).toBeCloseTo(5, 10);

    const frozen = tick(state, standing, makeContext(), 0.05).state;

    expect(frozen.tS).toBeCloseTo(5, 10);
    expect(frozen.distanceM).toBe(state.distanceM);
    expect(frozen.energyKj).toBe(state.energyKj);
  });
});

describe("auto-pause resume", () => {
  it("resumes on any power after pausing and unfreezes the sums", () => {
    let state = runTicks(makeState(), 101, inputs());

    expect(state.paused).toBe(true);

    state = tick(state, inputs({ powerW: 150, cadenceRpm: 90 }), makeContext(), 0.05).state;

    expect(state.paused).toBe(false);
    expect(state.stationaryS).toBe(0);
    expect(state.tS).toBeCloseTo(5.05, 10);
  });

  it("resumes on cadence alone", () => {
    let state = runTicks(makeState(), 101, inputs());

    state = tick(state, inputs({ powerW: 0, cadenceRpm: 85 }), makeContext(), 0.05).state;

    expect(state.paused).toBe(false);
  });

  it("does not accumulate stationary time while moving with cadence", () => {
    const state = runTicks(makeState(8.4), 200, inputs({ powerW: 150, cadenceRpm: 90 }));

    expect(state.paused).toBe(false);
    expect(state.stationaryS).toBe(0);
  });
});

describe("data loss rule (> 3 s without fresh trainer.data)", () => {
  it("keeps using the last readings through second 3.0 and zeroes them after", () => {
    const stale = inputs({ powerW: 200, cadenceRpm: 90, trainerDataFresh: false });

    const after60 = runTicks(makeState(8.4), 60, stale);

    expect(after60.dataAgeS).toBeCloseTo(3, 10);
    expect(after60.energyKj).toBeCloseTo(0.6, 9);

    const after61 = tick(after60, stale, makeContext(), 0.05).state;

    expect(after61.dataAgeS).toBeCloseTo(3.05, 10);
    // Raw power reads as zero from tick 61 on: no further energy accumulates.
    expect(after61.energyKj).toBeCloseTo(0.6, 9);
  });

  it("resets the data age on the next fresh reading", () => {
    let state = runTicks(
      makeState(8.4),
      61,
      inputs({ powerW: 200, cadenceRpm: 90, trainerDataFresh: false }),
    );

    state = tick(
      state,
      inputs({ powerW: 200, cadenceRpm: 90, trainerDataFresh: true }),
      makeContext(),
      0.05,
    ).state;

    expect(state.dataAgeS).toBe(0);
  });

  it("counts zeroed readings as stationary input for the pause machine", () => {
    // Standing, no data: after 101 stale ticks the zeroed cadence pauses the ride.
    const state = runTicks(makeState(), 101, inputs({ trainerDataFresh: false }));

    expect(state.paused).toBe(true);
  });
});
