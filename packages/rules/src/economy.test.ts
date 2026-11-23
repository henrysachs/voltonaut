import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";

import { DailyVoltsBudgetSchema, RewardFactsSchema } from "@voltonaut/shared";

import { applyDailyLimit, calculateBaseRewards, type BaseVoltsQuote } from "./index.js";

function volts(energyKj: number, elevationGainM = 0) {
  return calculateBaseRewards(
    RewardFactsSchema.parse({
      activeDistanceM: 0,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM,
      energyKj,
    }),
  ).volts;
}

describe("base Volts and explicit daily budget", () => {
  it.each([
    [0, 0, { work: 0, climb: 0, total: 0 }],
    [0.99, 0.6, { work: 0, climb: 0, total: 0 }],
    [1, 2 / 3, { work: 1, climb: 1, total: 2 }],
    [1.01, 0.7, { work: 1, climb: 1, total: 2 }],
    [2.9, 3, { work: 2, climb: 4, total: 6 }],
  ])(
    "floors mechanical work %s and total climb %s independently",
    (energy: number, elevation: number, expected: ReturnType<typeof volts>) => {
      expect(volts(energy, elevation)).toEqual(expected);
    },
  );
});

describe("public candidate validation", () => {
  it.each([-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed typed candidate fields %s",
    (value) => {
      const candidates: readonly BaseVoltsQuote[] = [
        { work: 0, climb: 0, total: value },
        { work: value, climb: 0, total: value },
        { work: 0, climb: value, total: value },
      ];

      for (const candidate of candidates) {
        expect(() => applyDailyLimit(candidate, DailyVoltsBudgetSchema.parse(3000))).toThrow(Error);
      }
    },
  );

  it("rejects inconsistent typed components and unsafe sums", () => {
    for (const candidate of [
      { work: 0, climb: 0, total: 100 },
      { work: 2, climb: 3, total: 4 },
      { work: Number.MAX_SAFE_INTEGER, climb: 1, total: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(() => applyDailyLimit(candidate, DailyVoltsBudgetSchema.parse(3000))).toThrow(Error);
    }
  });

  it("rejects extra candidate fields at the public boundary", () => {
    const candidate = { work: 0, climb: 0, total: 0, accepted: true };
    expect(() => applyDailyLimit(candidate, DailyVoltsBudgetSchema.parse(3000))).toThrow(Error);
  });
});

describe("parsed candidate accounting", () => {
  it("uses the parsed candidate copy, not changing caller getters", () => {
    let reads = 0;
    let value = 4;

    const candidate: BaseVoltsQuote = {
      work: 4,
      climb: 0,
      get total() {
        reads += 1;

        const result = value;
        value = -1;

        return result;
      },
    };

    expect(applyDailyLimit(candidate, DailyVoltsBudgetSchema.parse(3000))).toEqual({
      quotedVolts: 4,
      withheldVolts: 0,
      remainingVolts: 2996,
    });
    expect(reads).toBe(1);
  });

  it("accepts the largest safe consistent candidate without clamping", () => {
    expect(
      applyDailyLimit(
        { work: Number.MAX_SAFE_INTEGER - 1, climb: 1, total: Number.MAX_SAFE_INTEGER },
        DailyVoltsBudgetSchema.parse(3000),
      ),
    ).toEqual({
      quotedVolts: 3000,
      withheldVolts: Number.MAX_SAFE_INTEGER - 3000,
      remainingVolts: 0,
    });
  });

  it("rejects a missing daily budget at the public boundary", () => {
    expect(applyDailyLimit.bind(undefined, volts(1))).toThrow("Required");
  });
});

describe("daily budget accounting", () => {
  it.each([
    [0, 3000, 0, 0, 3000],
    [1, 0, 0, 1, 0],
    [1, 1, 1, 0, 0],
    [49, 50, 49, 0, 1],
    [50, 50, 50, 0, 0],
    [51, 50, 50, 1, 0],
    [3001, 3000, 3000, 1, 0],
  ])(
    "limits candidate %s to remaining budget %s",
    (candidate, budget, quotedVolts, withheldVolts, remainingVolts) => {
      const result = applyDailyLimit(volts(candidate), DailyVoltsBudgetSchema.parse(budget));
      expect(result).toEqual({ quotedVolts, withheldVolts, remainingVolts });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it("conserves a restored partial budget across several rides without a daily reset", () => {
    let remaining = DailyVoltsBudgetSchema.parse(1200);
    let quoted = 0;
    let withheld = 0;

    for (const candidate of [400, 500, 600, 700]) {
      const result = applyDailyLimit(volts(candidate), remaining);
      quoted += result.quotedVolts;
      withheld += result.withheldVolts;
      remaining = DailyVoltsBudgetSchema.parse(result.remainingVolts);
    }

    expect({ quoted, withheld, remaining }).toEqual({ quoted: 1200, withheld: 1000, remaining: 0 });
  });

  it("accounts for every candidate Volt and every unit of remaining budget", () => {
    assert(
      property(
        integer({ min: 0, max: 1_000_000_000_000 }),
        integer({ min: 0, max: 3000 }),
        (candidate, budget) => {
          const result = applyDailyLimit(volts(candidate), DailyVoltsBudgetSchema.parse(budget));
          expect(result.quotedVolts).toBeGreaterThanOrEqual(0);
          expect(result.quotedVolts).toBeLessThanOrEqual(budget);
          expect(result.quotedVolts + result.withheldVolts).toBe(candidate);
          expect(result.remainingVolts + result.quotedVolts).toBe(budget);
        },
      ),
    );
  });
});
