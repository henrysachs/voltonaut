import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";

import { RewardEffortSchema, RewardFactsSchema, type RewardEffort } from "@voltonaut/shared";

import { calculateBaseRewards, isXpActive } from "./index.js";

describe("public effort validation", () => {
  it.each([-1, NaN, Infinity, -Infinity, 2000.01])(
    "rejects malformed effort despite a retained spread brand %s",
    (value) => {
      const valid = RewardEffortSchema.parse({ powerW: 40, cadenceRpm: 30 });
      const power: RewardEffort = { ...valid, powerW: value };
      const cadence: RewardEffort = { ...valid, cadenceRpm: value };

      expect(() => isXpActive(power)).toThrow(Error);
      expect(() => isXpActive(cadence)).toThrow(Error);
    },
  );

  it("uses parsed effort instead of rereading changing caller getters", () => {
    let reads = 0;
    let value = 40;

    const effort: RewardEffort = {
      ...RewardEffortSchema.parse({ powerW: 40, cadenceRpm: 30 }),
      get powerW() {
        reads += 1;

        const result = value;
        value = 0;

        return result;
      },
    };

    expect(isXpActive(effort)).toBe(true);
    expect(reads).toBe(1);
  });

  it("rejects extra effort fields at the public boundary", () => {
    const effort = { ...RewardEffortSchema.parse({ powerW: 40, cadenceRpm: 30 }), accepted: true };
    expect(() => isXpActive(effort)).toThrow(Error);
  });
});

describe("base XP", () => {
  it.each([
    [0, 0, false],
    [30, 20, false],
    [30, 90, false],
    [200, 20, false],
    [30 - 2 ** -48, 90, false],
    [200, 20 - 2 ** -48, false],
    [30 + 2 ** -48, 20 + 2 ** -48, true],
    [2000, 200, true],
  ])("requires both raw thresholds at %s W and %s rpm", (powerW, cadenceRpm, expected) => {
    expect(isXpActive(RewardEffortSchema.parse({ powerW, cadenceRpm }))).toBe(expected);
  });
});

describe("whole-ride XP rounding", () => {
  it.each([
    [0, 0, 0, { distance: 0, elevation: 0, time: 0, total: 0 }],
    [49.9, 0.49, 59.9, { distance: 0, elevation: 0, time: 0, total: 0 }],
    [50, 0.5, 60, { distance: 1, elevation: 1, time: 1, total: 3 }],
    [50.1, 0.51, 60.1, { distance: 1, elevation: 1, time: 1, total: 3 }],
    [75, 0.75, 90, { distance: 1, elevation: 1, time: 1, total: 3 }],
  ])(
    "floors components once, not their sum (%s m, %s Hm, %s s)",
    (
      activeDistanceM: number,
      activeElevationGainM: number,
      activeTimeS: number,
      xp: ReturnType<typeof calculateBaseRewards>["xp"],
    ) => {
      expect(
        calculateBaseRewards(
          RewardFactsSchema.parse({
            activeDistanceM,
            activeElevationGainM,
            activeTimeS,
            elevationGainM: activeElevationGainM,
            energyKj: 0,
          }),
        ).xp,
      ).toEqual(xp);
    },
  );
});

it("aggregates fractional contributions before rounding", () => {
  const part = RewardFactsSchema.parse({
    activeDistanceM: 25,
    activeElevationGainM: 0.25,
    activeTimeS: 30,
    elevationGainM: 0.25,
    energyKj: 0,
  });

  expect(calculateBaseRewards(part).xp.total).toBe(0);

  const whole = RewardFactsSchema.parse({
    activeDistanceM: 50,
    activeElevationGainM: 0.5,
    activeTimeS: 60,
    elevationGainM: 0.5,
    energyKj: 0,
  });

  expect(calculateBaseRewards(whole).xp.total).toBe(3);
});

describe("XP monotonicity", () => {
  it("never decreases XP as any active fact increases", () => {
    assert(
      property(
        integer({ min: 0, max: 1_000_000 }),
        integer({ min: 0, max: 1_000_000 }),
        integer({ min: 0, max: 21_599 }),
        (distance, elevation, time) => {
          const low = RewardFactsSchema.parse({
            activeDistanceM: distance,
            activeElevationGainM: elevation,
            activeTimeS: time,
            elevationGainM: elevation + 1,
            energyKj: 0,
          });

          const high = RewardFactsSchema.parse({
            ...low,
            activeDistanceM: distance + 1,
            activeElevationGainM: elevation + 1,
            activeTimeS: time + 1,
          });

          expect(calculateBaseRewards(high).xp.total).toBeGreaterThanOrEqual(
            calculateBaseRewards(low).xp.total,
          );
        },
      ),
    );
  });
});
