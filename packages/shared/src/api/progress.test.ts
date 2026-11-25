import { expect, expectTypeOf, it } from "vitest";

import {
  ErrorCodeSchema,
  ProgressRangeResponseSchema,
  type ProgressRangeResponse,
  type VoltsRideRangeReceipt,
} from "./index.js";

const journalId = "550e8400-e29b-41d4-a716-446655440000";
const uppercaseJournalId = journalId.toUpperCase();

const rangeReceipt = {
  entryId: "123e4567-e89b-42d3-a456-426614174001",
  journalId: uppercaseJournalId,
  startTick: 0,
  endTick: 120,
  rewardDay: "2026-11-25",
  cumulativeWorkVolts: 100,
  cumulativeClimbVolts: 20,
  candidateVolts: 120,
  awardedVolts: 120,
  withheldVolts: 0,
};

it("wraps a strict readonly Volts ride range receipt", () => {
  const parsed = ProgressRangeResponseSchema.parse({ range: rangeReceipt });

  expect(parsed.range.journalId).toBe(journalId);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.range)).toBe(true);
  expectTypeOf<ProgressRangeResponse["range"]>().toEqualTypeOf<VoltsRideRangeReceipt>();

  expect(ProgressRangeResponseSchema.safeParse({ range: rangeReceipt, extra: true }).success).toBe(
    false,
  );
  expect(
    ProgressRangeResponseSchema.safeParse({ range: { ...rangeReceipt, extra: true } }).success,
  ).toBe(false);
  expect(
    ProgressRangeResponseSchema.safeParse({ range: { ...rangeReceipt, endTick: 0 } }).success,
  ).toBe(false);
});

it("includes all progress transport error codes", () => {
  const codes = [
    "progress_consent_required",
    "progress_consent_conflict",
    "progress_source_disabled",
    "progress_source_rejected",
  ];

  for (const code of codes) expect(ErrorCodeSchema.parse(code)).toBe(code);
  expect(ErrorCodeSchema.safeParse("progress_unknown").success).toBe(false);
});
