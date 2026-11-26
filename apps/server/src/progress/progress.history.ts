import { and, asc, desc, eq, exists, inArray, lt, or } from "drizzle-orm";

import {
  PROGRESS_HISTORY_PAGE_SIZE,
  ProgressHistoryResponseSchema,
  type ProgressHistoryJournalInput,
  type ProgressHistoryResponse,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import type { ProgressRangeStore } from "./progress.range-store.js";
import type { ProgressTables, RideProgressJournalRow } from "./progress.schema.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Volts receipts carry Zod brands and Drizzle handles stay mutable; the rule cannot resolve these aliases. */
interface HistoryCursor {
  readonly createdAt: number;
  readonly journalId: string;
}

function parseCursor(before: string | undefined): HistoryCursor | undefined {
  if (before === undefined) return undefined;
  const [createdAt = "", journalId = ""] = before.split("_");

  return { createdAt: Number(createdAt), journalId };
}

function cursorOf(row: Readonly<RideProgressJournalRow>): string {
  return `${row.createdAt}_${row.journalId}`;
}

function summarize(
  journal: Readonly<RideProgressJournalRow>,
  receipts: readonly VoltsRideRangeReceipt[],
): ProgressHistoryJournalInput | undefined {
  const last = receipts.at(-1);

  if (last === undefined) return undefined;

  const sum = (pick: (receipt: VoltsRideRangeReceipt) => number) =>
    receipts.reduce((total, receipt) => total + pick(receipt), 0);

  return {
    journalId: journal.journalId,
    routeId: journal.routeId,
    startedAt: new Date(journal.startedAtMs).toISOString(),
    lastConfirmedAt: new Date(journal.lastEndedAtMs).toISOString(),
    confirmedTicks: last.endTick,
    rangeCount: receipts.length,
    rewardDays: [...new Set(receipts.map(({ rewardDay }) => rewardDay))].toSorted(),
    awardedVolts: sum(({ awardedVolts }) => awardedVolts),
    withheldVolts: sum(({ withheldVolts }) => withheldVolts),
    candidateVolts: sum(({ candidateVolts }) => candidateVolts),
  };
}

type HistoryDatabase = Readonly<Pick<ServerDatabase, "select">>;

function journalRows(
  db: HistoryDatabase,
  tables: ProgressTables,
  userId: string,
  cursor: HistoryCursor | undefined,
): readonly RideProgressJournalRow[] {
  const journals = tables.rideProgressJournals;
  const ranges = tables.rideProgressRanges;

  // Only journals with a stored receipt take a page slot; otherwise a page could come back short.
  const owner = and(
    eq(journals.userId, userId),
    exists(
      db
        .select({ journalId: ranges.journalId })
        .from(ranges)
        .where(and(eq(ranges.userId, userId), eq(ranges.journalId, journals.journalId))),
    ),
  );

  const older =
    cursor === undefined
      ? undefined
      : or(
          lt(journals.createdAt, cursor.createdAt),
          and(eq(journals.createdAt, cursor.createdAt), lt(journals.journalId, cursor.journalId)),
        );

  return db
    .select()
    .from(journals)
    .where(older === undefined ? owner : and(owner, older))
    .orderBy(desc(journals.createdAt), desc(journals.journalId))
    .limit(PROGRESS_HISTORY_PAGE_SIZE + 1)
    .all();
}

function receiptsByJournal(
  db: HistoryDatabase,
  store: Readonly<Pick<ProgressRangeStore, "receipt">>,
  tables: ProgressTables,
  { userId, journalIds }: Readonly<{ userId: string; journalIds: readonly string[] }>,
): ReadonlyMap<string, readonly VoltsRideRangeReceipt[]> {
  const ranges = tables.rideProgressRanges;
  const grouped = new Map<string, VoltsRideRangeReceipt[]>();

  if (journalIds.length === 0) return grouped;

  const rows = db
    .select()
    .from(ranges)
    .where(and(eq(ranges.userId, userId), inArray(ranges.journalId, [...journalIds])))
    .orderBy(asc(ranges.journalId), asc(ranges.startTick))
    .all();

  for (const row of rows) {
    const list = grouped.get(row.journalId) ?? [];

    list.push(store.receipt(row));
    grouped.set(row.journalId, list);
  }

  return grouped;
}

/** Confirmed ride journals of one account, newest first (spec E6-11 AK2). */
export function progressHistoryPage(
  db: HistoryDatabase,
  store: Readonly<Pick<ProgressRangeStore, "receipt">>,
  tables: ProgressTables,
  { userId, before }: Readonly<{ userId: string; before: string | undefined }>,
): ProgressHistoryResponse {
  const journals = journalRows(db, tables, userId, parseCursor(before));
  const page = journals.slice(0, PROGRESS_HISTORY_PAGE_SIZE);

  const receipts = receiptsByJournal(db, store, tables, {
    userId,
    journalIds: page.map(({ journalId }) => journalId),
  });

  const last = page.at(-1);

  return ProgressHistoryResponseSchema.parse({
    journals: page.flatMap((row) => summarize(row, receipts.get(row.journalId) ?? []) ?? []),
    nextCursor:
      journals.length > PROGRESS_HISTORY_PAGE_SIZE && last !== undefined ? cursorOf(last) : null,
  });
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
