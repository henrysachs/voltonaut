import { expect, it } from "vitest";
import { array, assert, integer, property } from "fast-check";

import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import {
  createEngine,
  createRoute,
  FLAT_LOOP,
  KOM_CLIMB,
  TEST_LOOP,
  type NativeTickFacts,
} from "../index.js";

function engine(route = FLAT_LOOP, initialRoutePosM = 0) {
  return createEngine({
    route: createRoute(route),
    profile: DEFAULT_RIDER_PROFILE,
    initialRoutePosM,
  });
}

it("returns effective raw readings and native contributions instead of HUD EMA", () => {
  const ride = engine();
  ride.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });
  ride.ingest({ type: "hr.data", tS: 0, bpm: 140 });
  const facts = ride.advance(0.05);

  expect(facts).toStrictEqual([
    {
      powerW: 200,
      cadenceRpm: 90,
      timeS: 0.05,
      distanceM: ride.snapshot().speedMps * 0.05,
      elevationGainM: 0,
      energyKj: 0.01,
    },
  ]);
  expect(ride.snapshot().powerW).toBeLessThan(200);
  expect(ride.snapshot().cadenceRpm).toBeLessThan(90);
  expect(ride.snapshot().hrBpm).toBe(140);
});

it("retains fractional advances without inventing a tick", () => {
  const ride = engine();

  expect(ride.advance(0.025)).toStrictEqual([]);
  expect(ride.advance(0.025)).toHaveLength(1);
  expect(ride.snapshot().tS).toBe(0.05);
});

it("preserves the native distinction between one 0.15 advance and three 0.05 advances", () => {
  const batch = engine();
  const partitioned = engine();

  expect(batch.advance(0.15)).toHaveLength(2);
  expect([
    ...partitioned.advance(0.05),
    ...partitioned.advance(0.05),
    ...partitioned.advance(0.05),
  ]).toHaveLength(3);
  expect(batch.snapshot().tS).toBe(0.1);
  expect(partitioned.snapshot().tS).toBe(0.15000000000000002);
});

it("reports a freshness transition inside one unchanged advance", () => {
  const ride = engine();
  ride.ingest({ type: "trainer.data", tS: 0, powerW: 300, cadenceRpm: 80 });
  ride.advance(3);
  const facts = ride.advance(0.15);

  expect(facts.map((fact) => [fact.powerW, fact.cadenceRpm, fact.energyKj])).toStrictEqual([
    [300, 80, 0.015],
    [0, 0, 0],
  ]);
  expect(ride.snapshot().powerW).toBeGreaterThan(0);
});

it("returns zero contributions while paused and real contributions when resumed", () => {
  const ride = engine();
  ride.advance(6);
  expect(ride.snapshot().paused).toBe(true);
  expect(ride.advance(0.05)).toStrictEqual([
    { powerW: 0, cadenceRpm: 0, timeS: 0, distanceM: 0, elevationGainM: 0, energyKj: 0 },
  ]);
  ride.ingest({ type: "trainer.data", tS: 6, powerW: 200, cadenceRpm: 90 });
  expect(ride.advance(0.05)).toStrictEqual([
    {
      powerW: 200,
      cadenceRpm: 90,
      timeS: 0.05,
      distanceM: ride.snapshot().speedMps * 0.05,
      elevationGainM: 0,
      energyKj: 0.01,
    },
  ]);
  expect(ride.snapshot().paused).toBe(false);
});

it("keeps effective raw readings on the pause-entry tick", () => {
  const ride = engine();
  let facts: readonly NativeTickFacts[] = [];

  for (let tickNumber = 0; tickNumber < 101; tickNumber += 1) {
    ride.ingest({
      type: "trainer.data",
      tS: tickNumber * 0.05,
      powerW: 1,
      cadenceRpm: 0,
    });
    facts = ride.advance(0.05);
  }

  expect(ride.snapshot().paused).toBe(true);
  expect(facts).toStrictEqual([
    { powerW: 1, cadenceRpm: 0, timeS: 0, distanceM: 0, elevationGainM: 0, energyKj: 0 },
  ]);
});

it("returns contributions rather than the cumulative odometer", () => {
  const ride = engine(FLAT_LOOP, 1000);
  ride.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });

  expect(ride.advance(0.05)).toStrictEqual([
    {
      powerW: 200,
      cadenceRpm: 90,
      timeS: 0.05,
      distanceM: ride.snapshot().speedMps * 0.05,
      elevationGainM: 0,
      energyKj: 0.01,
    },
  ]);
  expect(ride.snapshot().distanceM).toBeGreaterThan(1000);
});

it("preserves raw threshold values without making reward-policy decisions", () => {
  const ride = engine();
  ride.ingest({ type: "trainer.data", tS: 0, powerW: 30, cadenceRpm: 20 });

  expect(ride.advance(0.05)).toStrictEqual([
    {
      powerW: 30,
      cadenceRpm: 20,
      timeS: 0.05,
      distanceM: ride.snapshot().speedMps * 0.05,
      elevationGainM: 0,
      energyKj: 0.0015,
    },
  ]);
});

it("freezes the returned batch and each independent fact", () => {
  const ride = engine();
  ride.ingest({ type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 });
  const facts = ride.advance(0.1);
  const before = JSON.stringify(facts);

  expect(facts).toHaveLength(2);
  expect(Object.isFrozen(facts)).toBe(true);

  for (const fact of facts) {
    expect(Object.isFrozen(fact)).toBe(true);
    expect(() => Object.defineProperty(fact, "powerW", { value: 999 })).toThrow(TypeError);
  }

  expect(() => Object.defineProperty(facts, "0", { value: {} })).toThrow(TypeError);

  ride.ingest({ type: "trainer.data", tS: 1, powerW: 100, cadenceRpm: 60 });
  ride.advance(1);
  expect(JSON.stringify(facts)).toBe(before);
});

it("caps facts at the native catch-up limit and preserves the skipped-time event", () => {
  const ride = engine();
  const facts = ride.advance(30);

  expect(facts).toHaveLength(120);
  expect(ride.drainEvents()).toContainEqual({ type: "ride.clockSkipped", skippedS: 24 });
  expect(ride.advance(0)).toStrictEqual([]);
});

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  "returns no facts for an advance without native ticks: %s",
  (elapsedS) => {
    const ride = engine();

    expect(ride.advance(elapsedS)).toStrictEqual([]);
    expect(ride.drainEvents()).toStrictEqual([{ type: "ride.started" }]);
  },
);

it.each([FLAT_LOOP, KOM_CLIMB, TEST_LOOP])(
  "sums native facts in exactly the same order as the existing ride state: $id",
  (route) => {
    assert(
      property(
        array(integer({ min: 0, max: 600 }), { minLength: 1, maxLength: 30 }),
        (powers: readonly number[]) => {
          const ride = engine(route);
          let timeS = 0;
          let distanceM = 0;
          let elevationGainM = 0;
          let energyKj = 0;

          for (const powerW of powers) {
            ride.ingest({ type: "trainer.data", tS: timeS, powerW, cadenceRpm: 90 });

            for (const fact of ride.advance(0.15)) {
              timeS += fact.timeS;
              distanceM += fact.distanceM;
              elevationGainM += fact.elevationGainM;
              energyKj += fact.energyKj;
            }
          }

          expect({ timeS, distanceM, elevationGainM, energyKj }).toStrictEqual({
            timeS: ride.snapshot().tS,
            distanceM: ride.snapshot().distanceM,
            elevationGainM: ride.snapshot().elevationGainM,
            energyKj: ride.snapshot().energyKj,
          });
        },
      ),
      { numRuns: 30 },
    );
  },
);
