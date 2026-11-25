/* oxlint-disable typescript/prefer-readonly-parameter-types -- Append inputs are readonly contracts; Oxlint does not follow imported aliases. */
import type { RideProgressCheckpoint } from "@voltonaut/shared";

import {
  appendValidatedProgressBatch,
  assertProgressCheckpointContinuation,
} from "./progressBatch.js";
import { progressError } from "./progressOutboxFence.js";
import type { ProgressAppendRead } from "./progressOutboxIndexedTypes.js";
import { newValidatedProgressOutboxRow } from "./progressOutboxRow.js";
import {
  ProgressOutboxRowSchema,
  PROGRESS_OUTBOX_MAX_ROWS,
  type ProgressOutboxRow,
} from "./progressOutboxSchema.js";
import type { ProgressWriteFence } from "./progressOutbox.js";
import {
  checkProgressRow,
  progressBatchPrefix,
  sameProgressBatch,
  type ProgressChange,
} from "./progressOutboxRows.js";

function touchedRow(row: ProgressOutboxRow | undefined): ProgressOutboxRow | undefined {
  if (row === undefined) return undefined;

  try {
    return ProgressOutboxRowSchema.parse(row);
  } catch {
    throw progressError("corrupt", "Progress-Warteschlange beschädigt. Keine Daten geändert.");
  }
}

function touchedRows(rows: readonly ProgressOutboxRow[]): ProgressOutboxRow[] {
  return rows.map((row) => {
    const parsed = touchedRow(row);

    if (parsed === undefined) throw progressError("corrupt", "Progress-Zeile fehlt.");

    return parsed;
  });
}

function sameRow(
  left: ProgressOutboxRow | undefined,
  right: ProgressOutboxRow | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.apiOrigin === right.apiOrigin &&
    left.userId === right.userId &&
    left.journalId === right.journalId &&
    left.startTick === right.startTick
  );
}

interface AppendWrites {
  readonly puts: ProgressOutboxRow[];
  readonly added: number;
}

function sealedOpenRow(
  open: ProgressOutboxRow,
  batch: ProgressOutboxRow["payload"],
  fence: Readonly<ProgressWriteFence>,
): ProgressOutboxRow {
  if (!progressBatchPrefix(open.payload, batch)) {
    throw progressError("conflict", "Offener Progress-Batch darf nicht umgeschrieben werden.");
  }

  const changed = !sameProgressBatch(open.payload, batch);

  return newValidatedProgressOutboxRow({
    owner: fence,
    consentVersion: fence.consentVersion,
    sessionGeneration: changed ? fence.sessionGeneration : open.sessionGeneration,
    batch,
    phase: "sealed",
    state: open.state,
  });
}

function appendWrites(
  open: ProgressOutboxRow | undefined,
  update: ReturnType<typeof appendValidatedProgressBatch>,
  fence: Readonly<ProgressWriteFence>,
): AppendWrites {
  const puts: ProgressOutboxRow[] = [];
  let added = 0;

  for (const batch of update.sealed) {
    if (open !== undefined && batch.checkpoints[0]?.startTick === open.startTick) {
      puts.push(sealedOpenRow(open, batch, fence));
    } else {
      puts.push(
        newValidatedProgressOutboxRow({
          owner: fence,
          consentVersion: fence.consentVersion,
          sessionGeneration: fence.sessionGeneration,
          batch,
          phase: "sealed",
        }),
      );
      added += 1;
    }
  }

  if (update.open !== undefined) {
    puts.push(
      newValidatedProgressOutboxRow({
        owner: fence,
        consentVersion: fence.consentVersion,
        sessionGeneration: fence.sessionGeneration,
        batch: update.open,
        phase: "open",
      }),
    );

    if (open === undefined || update.open.checkpoints[0]?.startTick !== open.startTick) added += 1;
  }

  return { puts, added };
}

function duplicateProgressRow(
  rows: readonly ProgressOutboxRow[],
  checkpoint: RideProgressCheckpoint,
): ProgressOutboxRow | undefined {
  const duplicates = touchedRows(rows);
  const duplicate = duplicates[0];

  if (duplicate === undefined) return undefined;

  const seen = duplicate.payload.checkpoints.find(
    (entry) => entry.sequence === checkpoint.sequence,
  );

  if (
    duplicates.length !== 1 ||
    seen === undefined ||
    JSON.stringify(seen) !== JSON.stringify(checkpoint)
  ) {
    throw progressError("conflict", "Progress-Sequenz bereits mit anderen Fakten vorhanden.");
  }

  return duplicate;
}

function assertLastContinuation(
  last: ProgressOutboxRow,
  checkpoint: RideProgressCheckpoint,
  fence: Readonly<ProgressWriteFence>,
): void {
  const previous = last.payload.checkpoints.at(-1);

  if (previous === undefined) throw progressError("corrupt", "Progress-Batch ist leer.");

  try {
    assertProgressCheckpointContinuation(
      previous,
      checkpoint,
      fence.consentVersion,
      fence.sessionGeneration,
    );
  } catch {
    throw progressError(
      "conflict",
      "Progress-Sequenz oder Tickkette hat eine Lücke oder Überlappung.",
    );
  }
}

export function appendProgressRows(
  read: Readonly<ProgressAppendRead>,
  fence: Readonly<ProgressWriteFence>,
  checkpoint: RideProgressCheckpoint,
): ProgressChange<readonly ProgressOutboxRow[]> {
  const duplicate = duplicateProgressRow(read.sequenceRows, checkpoint);

  if (duplicate !== undefined) return { value: [duplicate] };

  if (read.openRows.length > 1)
    throw progressError("corrupt", "Mehrere offene Progress-Batches vorhanden.");
  const rawOpen = read.openRows[0];
  const open = touchedRow(rawOpen);
  const sharesOpenRow = sameRow(rawOpen, read.lastRow);
  const last = sharesOpenRow ? open : touchedRow(read.lastRow);

  if (open !== undefined) {
    checkProgressRow(open, fence);

    if (!sharesOpenRow)
      throw progressError("conflict", "Offener Progress-Batch ist nicht der letzte Batch.");
  } else if (last !== undefined) {
    checkProgressRow(last, fence);

    if (last.phase === "open")
      throw progressError("corrupt", "Offener Progress-Batch fehlt im Index.");
    assertLastContinuation(last, checkpoint, fence);
  }

  const update = appendValidatedProgressBatch({
    open: open?.state.kind === "blocked" ? undefined : open?.payload,
    checkpoint,
    consentVersion: fence.consentVersion,
    sessionGeneration: fence.sessionGeneration,
  });

  const sealed = open?.state.kind === "blocked" ? [open.payload, ...update.sealed] : update.sealed;
  const written = appendWrites(open, { ...update, sealed }, fence);

  if (read.accountCount + written.added > PROGRESS_OUTBOX_MAX_ROWS) {
    throw progressError(
      "capacity",
      `Progress-Speicher voll (${PROGRESS_OUTBOX_MAX_ROWS} Batches). Keine Daten gelöscht.`,
    );
  }

  return { value: written.puts, puts: written.puts };
}

export { runProgressAppend } from "./progressOutboxAppendIndexed.js";
