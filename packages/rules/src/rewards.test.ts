import { describe, expect, expectTypeOf, it } from "vitest";

import { DailyVoltsBudgetSchema, RewardFactsSchema, type RewardFacts } from "@voltonaut/shared";

import { applyDailyLimit, calculateBaseRewards, gearLabel } from "./index.js";

describe("base reward quotes", () => {
  it("quotes hand-calculated whole-ride components, never a grant", () => {
    const quote = calculateBaseRewards(
      RewardFactsSchema.parse({
        activeDistanceM: 20_000,
        activeElevationGainM: 300,
        activeTimeS: 3600,
        elevationGainM: 300,
        energyKj: 648,
      }),
    );

    expect(quote).toEqual({
      kind: "base_quote",
      xp: { distance: 400, elevation: 600, time: 60, total: 1060 },
      volts: { work: 648, climb: 450, total: 1098 },
    });
    expect(applyDailyLimit(quote.volts, DailyVoltsBudgetSchema.parse(50))).toEqual({
      quotedVolts: 50,
      withheldVolts: 1048,
      remainingVolts: 0,
    });
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.xp)).toBe(true);
    expect(Object.isFrozen(quote.volts)).toBe(true);
    expectTypeOf<typeof quote.kind>().toEqualTypeOf<"base_quote">();
    expectTypeOf<typeof quote.xp>().toEqualTypeOf<{
      readonly distance: number;
      readonly elevation: number;
      readonly time: number;
      readonly total: number;
    }>();
    expect(gearLabel(0)).toBe("1");
    expect(gearLabel(23)).toBe("24");
  });
});

describe("public facts validation", () => {
  const parsedFacts = RewardFactsSchema.parse({
    activeDistanceM: 0,
    activeElevationGainM: 0,
    activeTimeS: 0,
    elevationGainM: 0,
    energyKj: 0,
  });

  it.each([-1, NaN, Infinity, -Infinity, 1_000_000_000_001])(
    "rejects malformed facts despite a retained spread brand %s",
    (value) => {
      const candidates: readonly RewardFacts[] = [
        { ...parsedFacts, activeDistanceM: value },
        { ...parsedFacts, activeElevationGainM: value },
        { ...parsedFacts, activeTimeS: value },
        { ...parsedFacts, elevationGainM: value },
        { ...parsedFacts, energyKj: value },
      ];

      for (const facts of candidates) expect(() => calculateBaseRewards(facts)).toThrow(Error);
    },
  );

  it("rejects copied facts violating cross-field and duration limits", () => {
    const height: RewardFacts = { ...parsedFacts, activeElevationGainM: 1 };
    const duration: RewardFacts = { ...parsedFacts, activeTimeS: 21_600.001 };

    expect(() => calculateBaseRewards(height)).toThrow(Error);
    expect(() => calculateBaseRewards(duration)).toThrow(Error);
  });

  it("rejects extra facts fields at the public boundary", () => {
    const facts: RewardFacts = { ...parsedFacts };
    const extra = { ...facts, accepted: true };
    expect(() => calculateBaseRewards(extra)).toThrow(Error);
  });
});

describe("parsed facts and safe arithmetic", () => {
  it("uses one parsed facts copy across both component calculators", () => {
    let reads = 0;
    let value = 4;

    const facts: RewardFacts = {
      ...RewardFactsSchema.parse({
        activeDistanceM: 0,
        activeElevationGainM: 0,
        activeTimeS: 0,
        elevationGainM: 0,
        energyKj: 0,
      }),
      get energyKj() {
        reads += 1;

        const result = value;
        value = -1;

        return result;
      },
    };

    expect(calculateBaseRewards(facts).volts).toEqual({ work: 4, climb: 0, total: 4 });
    expect(reads).toBe(1);
  });
});

describe("quote facts and safe arithmetic", () => {
  it("separates active XP height from total Volts height and mechanical work", () => {
    expect(
      calculateBaseRewards(
        RewardFactsSchema.parse({
          activeDistanceM: 0,
          activeElevationGainM: 0,
          activeTimeS: 0,
          elevationGainM: 10,
          energyKj: 1.99,
        }),
      ),
    ).toEqual({
      kind: "base_quote",
      xp: { distance: 0, elevation: 0, time: 0, total: 0 },
      volts: { work: 1, climb: 15, total: 16 },
    });
  });

  it("returns safe integers even at every accepted arithmetic ceiling", () => {
    const quote = calculateBaseRewards(
      RewardFactsSchema.parse({
        activeDistanceM: 1_000_000_000_000,
        activeElevationGainM: 1_000_000_000_000,
        activeTimeS: 21_600,
        elevationGainM: 1_000_000_000_000,
        energyKj: 1_000_000_000_000,
      }),
    );

    expect(quote.xp).toEqual({
      distance: 20_000_000_000,
      elevation: 2_000_000_000_000,
      time: 360,
      total: 2_020_000_000_360,
    });
    expect(quote.volts).toEqual({
      work: 1_000_000_000_000,
      climb: 1_500_000_000_000,
      total: 2_500_000_000_000,
    });

    for (const value of [...Object.values(quote.xp), ...Object.values(quote.volts)]) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
});
