/* oxlint-disable typescript/prefer-readonly-parameter-types -- Row-change inputs are readonly contracts; Oxlint does not follow imported aliases. */
import type { ProgressOutboxRow } from "./progressOutboxSchema.js";
import { newProgressOutboxRow } from "./progressOutboxRow.js";
import type { ProgressWriteFence } from "./progressOutbox.js";
import {
  assertProgressJournal,
  journalProgressRows,
  progressRowOwner,
  type ProgressChange,
} from "./progressOutboxRows.js";

export function sealProgressRow(
  rows: readonly ProgressOutboxRow[],
  fence: Readonly<ProgressWriteFence>,
): ProgressChange<ProgressOutboxRow | undefined> {
  const journal = journalProgressRows(rows, fence);
  assertProgressJournal(journal);
  const open = journal.find((row) => row.phase === "open");

  if (open === undefined) return { value: undefined };

  const sealed = newProgressOutboxRow({
    owner: progressRowOwner(open),
    consentVersion: open.consentVersion,
    sessionGeneration: open.sessionGeneration,
    batch: open.payload,
    phase: "sealed",
    state: open.state,
  });

  return { value: sealed, puts: [sealed] };
}
