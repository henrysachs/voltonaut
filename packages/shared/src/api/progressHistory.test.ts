import { expect, it } from "vitest";

import { ProgressHistoryQuerySchema, ProgressHistoryResponseSchema } from "./index.js";

const JOURNAL = {
  journalId: "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  routeId: "voltonaut-loop",
  startedAt: "2026-11-26T08:00:00.000Z",
  lastConfirmedAt: "2026-11-26T08:30:00.000Z",
  confirmedTicks: 1800,
  rangeCount: 3,
  rewardDays: ["2026-11-26"],
  awardedVolts: 120,
  withheldVolts: 5,
  candidateVolts: 125,
};

const CURSOR = `1764144000000_${JOURNAL.journalId}`;

it("accepts a page of confirmed journals with a cursor", () => {
  const page = ProgressHistoryResponseSchema.parse({ journals: [JOURNAL], nextCursor: CURSOR });

  expect(page.journals[0]?.awardedVolts).toBe(120);
  expect(ProgressHistoryResponseSchema.parse({ journals: [], nextCursor: null }).journals).toEqual(
    [],
  );
});

it.each([
  ["unknown fields", { ...JOURNAL, extra: 1 }],
  ["volts that do not add up", { ...JOURNAL, withheldVolts: 6 }],
  ["a confirmation before the start", { ...JOURNAL, lastConfirmedAt: "2026-11-26T07:00:00.000Z" }],
  ["unsorted reward days", { ...JOURNAL, rewardDays: ["2026-11-27", "2026-11-26"] }],
  ["duplicate reward days", { ...JOURNAL, rewardDays: ["2026-11-26", "2026-11-26"] }],
  ["no confirmed range", { ...JOURNAL, rangeCount: 0 }],
  ["no reward day", { ...JOURNAL, rewardDays: [] }],
])("rejects %s", (_label: string, journal: Readonly<object>) => {
  expect(
    ProgressHistoryResponseSchema.safeParse({ journals: [journal], nextCursor: null }).success,
  ).toBe(false);
});

it("rejects more than one page and malformed cursors", () => {
  const journals = Array.from({ length: 21 }, () => JOURNAL);

  expect(ProgressHistoryResponseSchema.safeParse({ journals, nextCursor: null }).success).toBe(
    false,
  );
  expect(ProgressHistoryQuerySchema.safeParse({ before: CURSOR }).success).toBe(true);
  expect(ProgressHistoryQuerySchema.safeParse({}).success).toBe(true);
  expect(ProgressHistoryQuerySchema.safeParse({ before: "1_x" }).success).toBe(false);
  expect(ProgressHistoryQuerySchema.safeParse({ before: CURSOR, limit: 5 }).success).toBe(false);
});
