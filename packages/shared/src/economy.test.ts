import { describe, expect, expectTypeOf, it } from "vitest";

import { ErrorCodeSchema, VoltsBalanceResponseSchema } from "./api/index.js";
import {
  JournalIdSchema,
  VoltsAmountSchema,
  VoltsBalanceSchema,
  VoltsDebitAmountSchema,
  VoltsDebitCommandSchema,
  VoltsDebitReceiptSchema,
  VoltsDeltaSchema,
  VoltsIdempotencyKeySchema,
  VoltsRideRangeCommandSchema,
  VoltsRideRangeReceiptSchema,
  VoltsRewardDaySchema,
  type JournalId,
  type VoltsAmount,
  type VoltsBalance,
  type VoltsDebitAmount,
  type VoltsDebitCommand,
  type VoltsDebitReceipt,
  type VoltsDelta,
  type VoltsIdempotencyKey,
  type VoltsRideRangeCommand,
  type VoltsRideRangeReceipt,
  type VoltsRewardDay,
} from "./economy.js";
import { RewardFactsSchema, type RewardFacts } from "./rewards.js";

const journalId = "123e4567-e89b-42d3-a456-426614174000";
const uppercaseJournalId = "123E4567-E89B-42D3-A456-426614174000";
const entryId = "123e4567-e89b-42d3-a456-426614174001";
const invalidWholeNumbers = [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1];

const cumulativeFacts = RewardFactsSchema.parse({
  activeDistanceM: 1000,
  activeElevationGainM: 20,
  activeTimeS: 60,
  elevationGainM: 25,
  energyKj: 15,
});

const rewardDay = VoltsRewardDaySchema.parse("2024-02-29");
const idempotencyKey = VoltsIdempotencyKeySchema.parse("purchase:2026-11-24.1");
const amountVolts = VoltsDebitAmountSchema.parse(5);

const rideRangeCommand = {
  journalId: uppercaseJournalId,
  startTick: 10,
  endTick: 20,
  rewardDay,
  cumulativeFacts,
};

const debitCommand = { idempotencyKey, refId: "shop-item-1", amountVolts };

const rideRangeReceipt = {
  entryId,
  journalId: uppercaseJournalId,
  startTick: 10,
  endTick: 20,
  rewardDay,
  cumulativeWorkVolts: VoltsAmountSchema.parse(4),
  cumulativeClimbVolts: VoltsAmountSchema.parse(3),
  candidateVolts: VoltsAmountSchema.parse(7),
  awardedVolts: VoltsAmountSchema.parse(5),
  withheldVolts: VoltsAmountSchema.parse(2),
};

const debitReceipt = { entryId, refId: "shop-item-1", amountVolts };

describe("Volts scalar contracts", () => {
  it("brands safe nonnegative balances and amounts", () => {
    for (const schema of [VoltsBalanceSchema, VoltsAmountSchema]) {
      expect(schema.parse(0)).toBe(0);
      expect(schema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);

      for (const value of invalidWholeNumbers) expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it("brands positive safe debit amounts and safe signed deltas", () => {
    expect(VoltsDebitAmountSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(VoltsDeltaSchema.parse(-Number.MAX_SAFE_INTEGER)).toBe(-Number.MAX_SAFE_INTEGER);
    expect(VoltsDeltaSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);

    for (const value of [0, ...invalidWholeNumbers]) {
      expect(VoltsDebitAmountSchema.safeParse(value).success).toBe(false);
    }

    for (const value of [
      -Number.MAX_SAFE_INTEGER - 1,
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(VoltsDeltaSchema.safeParse(value).success).toBe(false);
    }
  });

  it("keeps scalar brands distinct at compile time", () => {
    expectTypeOf<number>().not.toExtend<VoltsBalance>();
    expectTypeOf<number>().not.toExtend<VoltsAmount>();
    expectTypeOf<number>().not.toExtend<VoltsDebitAmount>();
    expectTypeOf<number>().not.toExtend<VoltsDelta>();
    expectTypeOf<string>().not.toExtend<VoltsIdempotencyKey>();
    expectTypeOf<string>().not.toExtend<VoltsRewardDay>();
    expectTypeOf<string>().not.toExtend<JournalId>();
    expectTypeOf<VoltsBalance>().not.toExtend<VoltsAmount>();
    expectTypeOf<VoltsAmount>().not.toExtend<VoltsDebitAmount>();
    expectTypeOf<VoltsDebitAmount>().not.toExtend<VoltsDelta>();
    expectTypeOf<VoltsIdempotencyKey>().not.toExtend<JournalId>();
  });
});

describe("Volts identifiers and reward days", () => {
  it("validates idempotency keys and normalizes journal UUIDs", () => {
    for (const value of ["a", "0", "A.z_9:-", "a".repeat(200)]) {
      expect(VoltsIdempotencyKeySchema.parse(value)).toBe(value);
    }

    for (const value of [
      "",
      "a".repeat(201),
      ".leading",
      "_leading",
      "with space",
      "with/slash",
      "ä",
    ]) {
      expect(VoltsIdempotencyKeySchema.safeParse(value).success).toBe(false);
    }

    expect(JournalIdSchema.parse(uppercaseJournalId)).toBe(journalId);
    expect(JournalIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("accepts real UTC leap dates and rejects normalized or malformed dates", () => {
    for (const value of ["2024-02-29", "2000-02-29", "2026-11-24"]) {
      expect(VoltsRewardDaySchema.parse(value)).toBe(value);
    }

    for (const value of [
      "2023-02-29",
      "1900-02-29",
      "2024-04-31",
      "2024-00-01",
      "2024-13-01",
      "2024-01-00",
      "2024-1-01",
      "2024-01-01T00:00:00.000Z",
      "not-a-date",
    ]) {
      expect(VoltsRewardDaySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("Volts ride range command contract", () => {
  it("parses strict frozen cumulative facts and normalizes the journal UUID", () => {
    const parsed = VoltsRideRangeCommandSchema.parse(rideRangeCommand);

    expect(parsed).toEqual({ ...rideRangeCommand, journalId });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.cumulativeFacts)).toBe(true);
    expectTypeOf<VoltsRideRangeCommand>().toEqualTypeOf<{
      readonly journalId: JournalId;
      readonly startTick: number;
      readonly endTick: number;
      readonly rewardDay: VoltsRewardDay;
      readonly cumulativeFacts: RewardFacts;
    }>();

    for (const command of [
      { ...rideRangeCommand, journalId: "not-a-uuid" },
      { ...rideRangeCommand, startTick: -1 },
      { ...rideRangeCommand, startTick: 0.5 },
      { ...rideRangeCommand, endTick: 10 },
      { ...rideRangeCommand, rewardDay: "2023-02-29" },
      { ...rideRangeCommand, cumulativeFacts: { ...cumulativeFacts, energyKj: -1 } },
      { ...rideRangeCommand, facts: cumulativeFacts },
      { ...rideRangeCommand, accepted: true },
    ]) {
      expect(VoltsRideRangeCommandSchema.safeParse(command).success).toBe(false);
    }
  });
});

describe("Volts debit command contract", () => {
  it("requires a purchase-prefixed idempotency key", () => {
    const parsed = VoltsDebitCommandSchema.parse(debitCommand);

    expect(parsed).toEqual(debitCommand);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(
      VoltsDebitCommandSchema.parse({ ...debitCommand, idempotencyKey: "purchase:a" }),
    ).toEqual({
      ...debitCommand,
      idempotencyKey: "purchase:a",
    });
    expectTypeOf<VoltsDebitCommand>().toEqualTypeOf<{
      readonly idempotencyKey: VoltsIdempotencyKey;
      readonly refId: string;
      readonly amountVolts: VoltsDebitAmount;
    }>();

    for (const key of ["reward:a", "purchase", "Purchase:a", ".invalid"]) {
      expect(
        VoltsDebitCommandSchema.safeParse({ ...debitCommand, idempotencyKey: key }).success,
      ).toBe(false);
    }

    for (const command of [
      { ...debitCommand, refId: "" },
      { ...debitCommand, refId: "a".repeat(201) },
      { ...debitCommand, amountVolts: 0 },
      { ...debitCommand, accepted: true },
    ]) {
      expect(VoltsDebitCommandSchema.safeParse(command).success).toBe(false);
    }
  });
});

describe("Volts ride range receipt contract", () => {
  it("parses only strict frozen immutable posting fields", () => {
    const parsed = VoltsRideRangeReceiptSchema.parse(rideRangeReceipt);

    expect(parsed).toEqual({ ...rideRangeReceipt, journalId });
    expect(Object.isFrozen(parsed)).toBe(true);
    expectTypeOf<VoltsRideRangeReceipt>().toEqualTypeOf<{
      readonly entryId: string;
      readonly journalId: JournalId;
      readonly startTick: number;
      readonly endTick: number;
      readonly rewardDay: VoltsRewardDay;
      readonly cumulativeWorkVolts: VoltsAmount;
      readonly cumulativeClimbVolts: VoltsAmount;
      readonly candidateVolts: VoltsAmount;
      readonly awardedVolts: VoltsAmount;
      readonly withheldVolts: VoltsAmount;
    }>();

    for (const receipt of [
      { ...rideRangeReceipt, entryId: "not-a-uuid" },
      { ...rideRangeReceipt, journalId: "not-a-uuid" },
      { ...rideRangeReceipt, endTick: 10 },
      { ...rideRangeReceipt, candidateVolts: -1 },
      { ...rideRangeReceipt, awardedVolts: 4 },
      { ...rideRangeReceipt, remainingDailyVolts: 2995 },
      { ...rideRangeReceipt, voltsBalance: 22 },
      { ...rideRangeReceipt, accepted: true },
    ]) {
      expect(VoltsRideRangeReceiptSchema.safeParse(receipt).success).toBe(false);
    }
  });
});

describe("Volts debit receipt contract", () => {
  it("parses only strict frozen immutable posting fields", () => {
    const parsed = VoltsDebitReceiptSchema.parse(debitReceipt);

    expect(parsed).toEqual(debitReceipt);
    expect(Object.isFrozen(parsed)).toBe(true);
    expectTypeOf<VoltsDebitReceipt>().toEqualTypeOf<{
      readonly entryId: string;
      readonly refId: string;
      readonly amountVolts: VoltsDebitAmount;
    }>();

    for (const receipt of [
      { ...debitReceipt, entryId: "not-a-uuid" },
      { ...debitReceipt, refId: "" },
      { ...debitReceipt, amountVolts: 0 },
      { ...debitReceipt, voltsBalance: 15 },
      { ...debitReceipt, accepted: true },
    ]) {
      expect(VoltsDebitReceiptSchema.safeParse(receipt).success).toBe(false);
    }
  });
});

describe("Volts API contracts", () => {
  it("keeps the strict frozen balance response and ledger error codes", () => {
    const parsed = VoltsBalanceResponseSchema.parse({ voltsBalance: 12 });

    expect(parsed).toEqual({ voltsBalance: 12 });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(VoltsBalanceResponseSchema.safeParse({ voltsBalance: -1 }).success).toBe(false);
    expect(VoltsBalanceResponseSchema.safeParse({ voltsBalance: 12, extra: true }).success).toBe(
      false,
    );
    expect(ErrorCodeSchema.parse("insufficient_volts")).toBe("insufficient_volts");
    expect(ErrorCodeSchema.parse("ledger_conflict")).toBe("ledger_conflict");
  });
});
