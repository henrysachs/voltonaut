/* oxlint-disable typescript/prefer-readonly-parameter-types -- Row inputs are readonly contracts; Oxlint does not follow imported schema aliases. */
import type { ProgressCheckpointBatch } from "@voltonaut/shared";

import { groupProgressBatches, progressBatchStartTick } from "./progressBatch.js";
import { progressError } from "./progressOutboxFence.js";
import {
  PROGRESS_OUTBOX_MAX_ROWS,
  ProgressOutboxRowSchema,
  type ProgressAccountOwner,
  type ProgressJournalOwner,
  type ProgressOutboxRow,
  type ProgressOutboxState,
} from "./progressOutboxSchema.js";
import { newProgressOutboxRow, progressOutboxKey } from "./progressOutboxRow.js";
import type { ProgressWriteFence } from "./progressOutbox.js";

export interface ProgressChange<T> {
  readonly value: T;
  readonly puts?: readonly ProgressOutboxRow[];
  readonly deletes?: readonly ProgressOutboxRow[];
}

export function decodeProgressRows(
  raw: readonly ProgressOutboxRow[],
): readonly ProgressOutboxRow[] {
  const parsed = ProgressOutboxRowSchema.array().safeParse(raw);

  if (!parsed.success) {
    throw progressError("corrupt", "Progress-Warteschlange beschädigt. Keine Daten geändert.");
  }

  const keys = new Set<string>();
  const counts = new Map<string, number>();

  for (const row of parsed.data) {
    const key = JSON.stringify(progressOutboxKey(row));
    const account = JSON.stringify([row.apiOrigin, row.userId]);
    const count = (counts.get(account) ?? 0) + 1;

    if (keys.has(key) || count > PROGRESS_OUTBOX_MAX_ROWS) {
      throw progressError("corrupt", "Progress-Warteschlange beschädigt.");
    }

    keys.add(key);
    counts.set(account, count);
  }

  return sortProgressRows(parsed.data);
}

function sortProgressRows(rows: readonly ProgressOutboxRow[]): readonly ProgressOutboxRow[] {
  return rows.toSorted(
    (left, right) =>
      left.journalId.localeCompare(right.journalId) ||
      progressBatchStartTick(left.payload) - progressBatchStartTick(right.payload),
  );
}

export function accountProgressRows(
  rows: readonly ProgressOutboxRow[],
  owner: Readonly<ProgressAccountOwner>,
): readonly ProgressOutboxRow[] {
  return rows.filter((row) => row.apiOrigin === owner.apiOrigin && row.userId === owner.userId);
}

export function journalProgressRows(
  rows: readonly ProgressOutboxRow[],
  owner: Readonly<ProgressJournalOwner>,
): readonly ProgressOutboxRow[] {
  return sortProgressRows(
    rows.filter(
      (row) =>
        row.apiOrigin === owner.apiOrigin &&
        row.userId === owner.userId &&
        row.journalId === owner.journalId,
    ),
  );
}

export function assertProgressJournal(rows: readonly ProgressOutboxRow[]): void {
  groupProgressBatches(rows.map((row) => row.payload));
  const open = rows.findIndex((row) => row.phase === "open");

  if (open >= 0 && open !== rows.length - 1) {
    throw progressError("conflict", "Offener Progress-Batch ist nicht der letzte Batch.");
  }
}

export function findProgressRow(
  rows: readonly ProgressOutboxRow[],
  candidate: Readonly<ProgressOutboxRow>,
): ProgressOutboxRow | undefined {
  const key = JSON.stringify(progressOutboxKey(candidate));

  return rows.find((row) => JSON.stringify(progressOutboxKey(row)) === key);
}

export function sameProgressBatch(
  left: Readonly<ProgressCheckpointBatch>,
  right: Readonly<ProgressCheckpointBatch>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function progressBatchPrefix(
  prefix: Readonly<ProgressCheckpointBatch>,
  batch: Readonly<ProgressCheckpointBatch>,
): boolean {
  return (
    prefix.checkpoints.length <= batch.checkpoints.length &&
    prefix.checkpoints.every(
      (entry, index) => JSON.stringify(entry) === JSON.stringify(batch.checkpoints[index]),
    )
  );
}

export function checkProgressRow(
  row: Readonly<ProgressOutboxRow>,
  fence: Readonly<ProgressWriteFence>,
): void {
  if (
    row.apiOrigin !== fence.apiOrigin ||
    row.userId !== fence.userId ||
    row.journalId !== fence.journalId ||
    row.consentVersion !== fence.consentVersion
  ) {
    throw progressError("owner", "Progress-Batch gehört zu einem anderen Konto oder Journal.");
  }
}

export function progressRowOwner(row: Readonly<ProgressOutboxRow>): ProgressJournalOwner {
  return { apiOrigin: row.apiOrigin, userId: row.userId, journalId: row.journalId };
}

export function replaceProgressState(
  row: Readonly<ProgressOutboxRow>,
  state: ProgressOutboxState,
): ProgressOutboxRow {
  return newProgressOutboxRow({
    owner: progressRowOwner(row),
    consentVersion: row.consentVersion,
    sessionGeneration: row.sessionGeneration,
    batch: row.payload,
    phase: row.phase,
    state,
  });
}
