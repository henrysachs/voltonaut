import { z } from "zod";

import { JournalIdSchema, VoltsAmountSchema, VoltsRewardDaySchema } from "../economy.js";

export const PROGRESS_HISTORY_PAGE_SIZE = 20;

/** Opaque page boundary: creation time in ms and journal id of the last journal on a page. */
export const ProgressHistoryCursorSchema = z
  .string()
  .regex(/^\d{1,16}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

export const ProgressHistoryQuerySchema = z
  .object({ before: ProgressHistoryCursorSchema.optional() })
  .strict()
  .readonly();

/** One server-confirmed ride journal: only ranges with a stored receipt count (spec E6-11 AK1). */
export const ProgressHistoryJournalSchema = z
  .object({
    journalId: JournalIdSchema,
    routeId: z.string().min(1).max(64),
    startedAt: z.string().datetime(),
    lastConfirmedAt: z.string().datetime(),
    confirmedTicks: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    rangeCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    rewardDays: z.array(VoltsRewardDaySchema).min(1).max(400).readonly(),
    awardedVolts: VoltsAmountSchema,
    withheldVolts: VoltsAmountSchema,
    candidateVolts: VoltsAmountSchema,
  })
  .strict()
  .readonly()
  .refine(
    (journal: Readonly<{ awardedVolts: number; withheldVolts: number; candidateVolts: number }>) =>
      journal.awardedVolts + journal.withheldVolts === journal.candidateVolts,
    {
      message: "Awarded and withheld Volts must add up to the candidate",
      path: ["candidateVolts"],
    },
  )
  .refine(
    (journal: Readonly<{ startedAt: string; lastConfirmedAt: string }>) =>
      journal.lastConfirmedAt >= journal.startedAt,
    {
      message: "Confirmation must not precede the start",
      path: ["lastConfirmedAt"],
    },
  )
  .refine(
    (journal: Readonly<{ rewardDays: readonly string[] }>) =>
      journal.rewardDays.every(
        (day: string, index: number, days: readonly string[]) =>
          index === 0 || (days[index - 1] ?? "") < day,
      ),
    { message: "Reward days must be sorted and unique", path: ["rewardDays"] },
  );

export const ProgressHistoryResponseSchema = z
  .object({
    journals: z.array(ProgressHistoryJournalSchema).max(PROGRESS_HISTORY_PAGE_SIZE).readonly(),
    nextCursor: ProgressHistoryCursorSchema.nullable(),
  })
  .strict()
  .readonly();

export type ProgressHistoryJournal = z.infer<typeof ProgressHistoryJournalSchema>;

/** Unbranded journal summary before the response schema parses it. */
export type ProgressHistoryJournalInput = z.input<typeof ProgressHistoryJournalSchema>;

export type ProgressHistoryResponse = z.infer<typeof ProgressHistoryResponseSchema>;

export type ProgressHistoryQuery = z.infer<typeof ProgressHistoryQuerySchema>;
