import { array, assert, constant, integer, property, tuple } from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BaseVoltsQuoteSchema,
  RewardFactsSchema,
  VoltsBalanceSchema,
  VoltsDeltaSchema,
  type BaseVoltsQuote,
  type RewardFacts,
  type VoltsBalance,
} from "@voltonaut/shared";

import {
  applyVoltsDelta,
  calculateBaseRewards,
  quoteVoltsIncrement,
  type VoltsDeltaApplication,
  type VoltsIncrementQuote,
} from "./index.js";

const zeroFacts = RewardFactsSchema.parse({
  activeDistanceM: 0,
  activeElevationGainM: 0,
  activeTimeS: 0,
  elevationGainM: 0,
  energyKj: 0,
});

const zeroVolts = BaseVoltsQuoteSchema.parse({ work: 0, climb: 0, total: 0 });

function facts(energyKj: number, elevationGainM = 0): RewardFacts {
  return RewardFactsSchema.parse({ ...zeroFacts, energyKj, elevationGainM });
}

function applyDeltaSequence(initialBalance: number, deltaValues: readonly number[]) {
  let balance = VoltsBalanceSchema.parse(initialBalance);
  let acceptedDeltaSum = 0;
  const balances: number[] = [];

  for (const deltaValue of deltaValues) {
    const delta = VoltsDeltaSchema.parse(deltaValue);
    const result = applyVoltsDelta(balance, delta);

    if (result.kind === "applied") acceptedDeltaSum += delta;

    balances.push(result.balance);
    balance = result.balance;
  }

  return Object.freeze({ balance, acceptedDeltaSum, balances: Object.freeze(balances) });
}

type FactIncrement = readonly [
  energyKj: number,
  elevation: readonly [activeElevationGainM: number, elevationGainM: number],
  activeDistanceM: number,
  activeTimeS: number,
];

function buildFactCuts(increments: readonly FactIncrement[]) {
  let energyKj = 0;
  let elevationGainM = 0;
  let activeElevationGainM = 0;
  let activeDistanceM = 0;
  let activeTimeS = 0;
  let cumulative = zeroFacts;
  const cuts: RewardFacts[] = [cumulative];

  for (const [energy, [activeElevation, elevation], distance, time] of increments) {
    energyKj += energy;
    elevationGainM += elevation;
    activeElevationGainM += activeElevation;
    activeDistanceM += distance;
    activeTimeS += time;
    cumulative = RewardFactsSchema.parse({
      activeDistanceM,
      activeElevationGainM,
      activeTimeS,
      elevationGainM,
      energyKj,
    });
    cuts.push(cumulative);
  }

  return Object.freeze({ cuts: Object.freeze(cuts), finalFacts: cumulative });
}

function sumVoltsIncrements(cuts: readonly RewardFacts[]) {
  let previous = zeroVolts;
  let work = 0;
  let climb = 0;

  for (const cut of cuts) {
    const result = quoteVoltsIncrement(previous, cut);

    if (result.kind === "regressed") throw new Error("Monotone cumulative facts regressed");

    work += result.increment.work;
    climb += result.increment.climb;
    previous = result.cumulative;
  }

  return Object.freeze({ work, climb, total: work + climb });
}

describe("applyVoltsDelta results", () => {
  it.each([
    [10, 5, 15],
    [10, -3, 7],
    [10, 0, 10],
    [0, 0, 0],
  ])("applies %i Volts plus delta %i as %i", (balanceValue, deltaValue, expected) => {
    const result = applyVoltsDelta(
      VoltsBalanceSchema.parse(balanceValue),
      VoltsDeltaSchema.parse(deltaValue),
    );

    expect(result).toEqual({ kind: "applied", balance: expected });
    expect(Object.isFrozen(result)).toBe(true);
    expectTypeOf(result).toEqualTypeOf<VoltsDeltaApplication>();
  });

  it("accepts the largest safe balance and rejects an unaffordable debit unchanged", () => {
    expect(
      applyVoltsDelta(
        VoltsBalanceSchema.parse(Number.MAX_SAFE_INTEGER - 1),
        VoltsDeltaSchema.parse(1),
      ),
    ).toEqual({ kind: "applied", balance: Number.MAX_SAFE_INTEGER });
    expect(applyVoltsDelta(VoltsBalanceSchema.parse(3), VoltsDeltaSchema.parse(-4))).toEqual({
      kind: "insufficient_volts",
      balance: 3,
    });
    expectTypeOf<
      Extract<VoltsDeltaApplication, { kind: "insufficient_volts" }>["balance"]
    >().toEqualTypeOf<VoltsBalance>();
  });
});

describe("applyVoltsDelta validation", () => {
  it("reparses malformed branded balances and deltas", () => {
    const balance = VoltsBalanceSchema.parse(10);
    const delta = VoltsDeltaSchema.parse(0);

    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      // @ts-expect-error Deliberately malformed branded balance exercises runtime validation.
      const applyMalformedBalance = () => applyVoltsDelta(value, delta);
      expect(applyMalformedBalance).toThrow(Error);
    }

    for (const value of [-Number.MAX_SAFE_INTEGER - 1, 0.5, NaN, Infinity]) {
      // @ts-expect-error Deliberately malformed branded delta exercises runtime validation.
      const applyMalformedDelta = () => applyVoltsDelta(balance, value);
      expect(applyMalformedDelta).toThrow(Error);
    }
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, 1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [Number.MAX_SAFE_INTEGER - 1, 2],
  ])("throws RangeError when balance %i plus delta %i overflows", (balanceValue, deltaValue) => {
    expect(() =>
      applyVoltsDelta(VoltsBalanceSchema.parse(balanceValue), VoltsDeltaSchema.parse(deltaValue)),
    ).toThrow(RangeError);
  });
});

describe("applyVoltsDelta properties", () => {
  it("never produces a negative balance and conserves accepted deltas", () => {
    assert(
      property(
        integer({ min: 0, max: Number.MAX_SAFE_INTEGER - 100_000 }),
        array(integer({ min: -1000, max: 1000 }), { maxLength: 100 }),
        (initialBalance: number, deltaValues: readonly number[]) => {
          const result = applyDeltaSequence(initialBalance, deltaValues);

          for (const balance of result.balances) {
            expect(balance).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(balance)).toBe(true);
          }

          expect(result.balance).toBe(initialBalance + result.acceptedDeltaSum);
        },
      ),
    );
  });
});

describe("quoteVoltsIncrement", () => {
  it("returns frozen cumulative-minus-previous components", () => {
    const previous = BaseVoltsQuoteSchema.parse({ work: 10, climb: 20, total: 30 });
    const result = quoteVoltsIncrement(previous, facts(12.9, 14));

    expect(result).toEqual({
      kind: "increment",
      cumulative: { work: 12, climb: 21, total: 33 },
      increment: { work: 2, climb: 1, total: 3 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cumulative)).toBe(true);
    expect(Object.isFrozen(result.increment)).toBe(true);
    expectTypeOf(result).toEqualTypeOf<VoltsIncrementQuote>();
  });

  it("returns a zero increment for unchanged cumulative facts", () => {
    expect(quoteVoltsIncrement(zeroVolts, zeroFacts)).toEqual({
      kind: "increment",
      cumulative: zeroVolts,
      increment: zeroVolts,
    });
  });
});

describe("quoteVoltsIncrement regression", () => {
  it.each([
    [{ work: 20, climb: 5, total: 25 }, 10, 8, { work: 10, climb: 12, total: 22 }],
    [{ work: 5, climb: 20, total: 25 }, 8, 10, { work: 8, climb: 15, total: 23 }],
  ])(
    "rejects component regression from %j",
    (
      previousValue: Readonly<BaseVoltsQuote>,
      energy: number,
      elevation: number,
      cumulative: Readonly<BaseVoltsQuote>,
    ) => {
      const result = quoteVoltsIncrement(
        BaseVoltsQuoteSchema.parse(previousValue),
        facts(energy, elevation),
      );

      expect(result).toEqual({ kind: "regressed", cumulative });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.cumulative)).toBe(true);
      expectTypeOf<
        Extract<VoltsIncrementQuote, { kind: "regressed" }>["cumulative"]
      >().toEqualTypeOf<BaseVoltsQuote>();
    },
  );
});

describe("quoteVoltsIncrement validation", () => {
  it("reparses malformed previous quotes and cumulative facts", () => {
    for (const previous of [
      { work: -1, climb: 0, total: -1 },
      { work: 1, climb: 2, total: 4 },
      { work: 0, climb: 0, total: 0, accepted: true },
    ]) {
      expect(() => quoteVoltsIncrement(previous, zeroFacts)).toThrow(Error);
    }

    for (const cumulativeFacts of [
      { ...zeroFacts, energyKj: -1 },
      { ...zeroFacts, activeElevationGainM: 1 },
      { ...zeroFacts, accepted: true },
    ]) {
      expect(() => quoteVoltsIncrement(zeroVolts, cumulativeFacts)).toThrow(Error);
    }
  });
});

describe("quoteVoltsIncrement properties", () => {
  it("telescopes arbitrary monotone cumulative fact cuts to the final whole-ride quote", () => {
    const elevationIncrement = integer({ min: 0, max: 1000 }).chain((elevationGainM) =>
      tuple(integer({ min: 0, max: elevationGainM }), constant(elevationGainM)),
    );

    const factIncrement = tuple(
      integer({ min: 0, max: 1000 }),
      elevationIncrement,
      integer({ min: 0, max: 1000 }),
      integer({ min: 0, max: 100 }),
    );

    assert(
      property(array(factIncrement, { maxLength: 50 }), (increments: readonly FactIncrement[]) => {
        const { cuts, finalFacts } = buildFactCuts(increments);

        expect(sumVoltsIncrements(cuts)).toEqual(calculateBaseRewards(finalFacts).volts);
      }),
    );
  });
});
