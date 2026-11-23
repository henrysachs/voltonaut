import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BaseVoltsQuoteSchema,
  DailyVoltsBudgetSchema,
  LevelSchema,
  RewardEffortSchema,
  RewardFactsSchema,
  TotalXpSchema,
  type DailyVoltsBudget,
  type Level,
  type RewardEffort,
  type RewardFacts,
  type TotalXp,
} from "./rewards.js";

const zero = {
  activeDistanceM: 0,
  activeElevationGainM: 0,
  activeTimeS: 0,
  elevationGainM: 0,
  energyKj: 0,
};

describe("candidate Volts schema", () => {
  it("validates strict frozen consistent safe-integer Volts candidates", () => {
    const candidate = { work: 2, climb: 3, total: 5 };
    expect(BaseVoltsQuoteSchema.parse(candidate)).toEqual(candidate);
    expect(Object.isFrozen(BaseVoltsQuoteSchema.parse(candidate))).toBe(true);
    expectTypeOf<ReturnType<typeof BaseVoltsQuoteSchema.parse>>().toEqualTypeOf<{
      readonly work: number;
      readonly climb: number;
      readonly total: number;
    }>();
    expect(BaseVoltsQuoteSchema.safeParse({ ...candidate, accepted: true }).success).toBe(false);

    for (const value of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(BaseVoltsQuoteSchema.safeParse({ work: value, climb: 0, total: value }).success).toBe(
        false,
      );
      expect(BaseVoltsQuoteSchema.safeParse({ work: 0, climb: value, total: value }).success).toBe(
        false,
      );
      expect(BaseVoltsQuoteSchema.safeParse({ work: 0, climb: 0, total: value }).success).toBe(
        false,
      );
    }

    expect(BaseVoltsQuoteSchema.safeParse({ work: 2, climb: 3, total: 4 }).success).toBe(false);
    expect(
      BaseVoltsQuoteSchema.safeParse({
        work: Number.MAX_SAFE_INTEGER,
        climb: 1,
        total: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(false);
    expect(
      BaseVoltsQuoteSchema.safeParse({
        work: Number.MAX_SAFE_INTEGER - 1,
        climb: 1,
        total: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true);
  });
});

describe("reward boundaries", () => {
  it("constructs frozen branded facts and effective unsmoothed effort", () => {
    expect(RewardFactsSchema.parse(zero)).toEqual(zero);
    expect(Object.isFrozen(RewardFactsSchema.parse(zero))).toBe(true);
    expect(Object.isFrozen(RewardEffortSchema.parse({ powerW: 2000, cadenceRpm: 200 }))).toBe(true);
    expectTypeOf<typeof zero>().not.toExtend<RewardFacts>();
    expectTypeOf<{ powerW: number; cadenceRpm: number }>().not.toExtend<RewardEffort>();
    expectTypeOf<RewardFacts>().toExtend<Readonly<typeof zero>>();
  });

  it.each([-1, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER])(
    "rejects invalid or arithmetically excessive facts %s",
    (value) => {
      for (const key of Object.keys(zero)) {
        expect(RewardFactsSchema.safeParse({ ...zero, [key]: value }).success).toBe(false);
      }
    },
  );

  it("accepts inclusive numerical ceilings, rejects overflow and inconsistent elevation", () => {
    const ceiling = {
      activeDistanceM: 1_000_000_000_000,
      activeElevationGainM: 1_000_000_000_000,
      activeTimeS: 21_600,
      elevationGainM: 1_000_000_000_000,
      energyKj: 1_000_000_000_000,
    };

    expect(RewardFactsSchema.safeParse(ceiling).success).toBe(true);

    for (const key of Object.keys(ceiling)) {
      expect(RewardFactsSchema.safeParse({ ...ceiling, [key]: 1_000_000_000_001 }).success).toBe(
        false,
      );
    }

    expect(RewardFactsSchema.safeParse({ ...zero, activeTimeS: 21_600.001 }).success).toBe(false);
    expect(RewardFactsSchema.safeParse({ ...zero, activeElevationGainM: 0.01 }).success).toBe(
      false,
    );
    expect(RewardFactsSchema.safeParse({ ...zero, accepted: true }).success).toBe(false);
  });
});

it("keeps fact fields readonly and scalar input domains distinct at compile time", () => {
  expectTypeOf<Pick<RewardFacts, "activeDistanceM">>().toEqualTypeOf<{
    readonly activeDistanceM: number;
  }>();
  expectTypeOf<Pick<RewardEffort, "powerW">>().toEqualTypeOf<{ readonly powerW: number }>();
  expectTypeOf<number>().not.toExtend<TotalXp>();
  expectTypeOf<number>().not.toExtend<Level>();
  expectTypeOf<number>().not.toExtend<DailyVoltsBudget>();
  expectTypeOf<TotalXp>().not.toExtend<DailyVoltsBudget>();
  expectTypeOf<Level>().not.toExtend<TotalXp>();
});

describe("effort and reward scalar boundaries", () => {
  it.each([
    { powerW: -1, cadenceRpm: 90 },
    { powerW: 2000.01, cadenceRpm: 90 },
    { powerW: 200, cadenceRpm: -1 },
    { powerW: 200, cadenceRpm: 200.01 },
    { powerW: NaN, cadenceRpm: 90 },
    { powerW: 200, cadenceRpm: Infinity },
  ])(
    "rejects out-of-contract effort $powerW W / $cadenceRpm rpm",
    (effort: Readonly<{ powerW: number; cadenceRpm: number }>) => {
      expect(RewardEffortSchema.safeParse(effort).success).toBe(false);
    },
  );

  it("brands safe whole total XP, levels and remaining daily budget", () => {
    for (const value of [0, Number.MAX_SAFE_INTEGER]) {
      expect(TotalXpSchema.parse(value)).toBe(value);
    }

    for (const value of [0, 3000]) expect(DailyVoltsBudgetSchema.parse(value)).toBe(value);

    for (const value of [1, 50]) expect(LevelSchema.parse(value)).toBe(value);

    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(TotalXpSchema.safeParse(value).success).toBe(false);
      expect(DailyVoltsBudgetSchema.safeParse(value).success).toBe(false);
      expect(LevelSchema.safeParse(value).success).toBe(false);
    }

    expect(LevelSchema.safeParse(0).success).toBe(false);
    expect(LevelSchema.safeParse(51).success).toBe(false);
    expect(DailyVoltsBudgetSchema.safeParse(3001).success).toBe(false);
  });
});
