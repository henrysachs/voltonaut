/* oxlint-disable typescript/prefer-readonly-parameter-types -- Stored-row inputs are readonly contracts; Oxlint does not follow imported aliases. */
import { VoltsRideRangeReceiptSchema, type VoltsRideRangeReceipt } from "@voltonaut/shared";

import {
  checkProgressFence,
  normalizeProgressFence,
  progressError,
} from "./progressOutboxFence.js";
import { runProgressKeyedChange } from "./progressOutboxChange.js";
import type { ProgressIndexedDatabase } from "./progressOutboxIndexedTypes.js";
import { ProgressOutboxRowSchema, type ProgressOutboxRow } from "./progressOutboxSchema.js";
import type { ProgressMarkStored } from "./progressOutbox.js";
import {
  checkProgressRow,
  findProgressRow,
  replaceProgressState,
  sameProgressBatch,
  type ProgressChange,
} from "./progressOutboxRows.js";
import { progressOutboxKey, progressReceiptCoversRow } from "./progressOutboxRow.js";

export function storedProgressRow(
  existing: Readonly<ProgressOutboxRow> | undefined,
  candidate: Readonly<ProgressOutboxRow>,
  receipt: Readonly<VoltsRideRangeReceipt>,
): ProgressOutboxRow {
  if (
    existing !== undefined &&
    (existing.apiOrigin !== candidate.apiOrigin ||
      existing.userId !== candidate.userId ||
      existing.journalId !== candidate.journalId ||
      !sameProgressBatch(existing.payload, candidate.payload))
  ) {
    throw progressError("conflict", "Progress-ID bereits mit anderen Daten vorhanden.");
  }

  const attempts = existing === undefined ? 1 : Math.max(1, existing.state.attempts);

  return replaceProgressState(candidate, { kind: "stored", attempts, retryAtMs: 0, receipt });
}

function storeProgressChange(
  existing: Readonly<ProgressOutboxRow> | undefined,
  candidate: Readonly<ProgressOutboxRow>,
  receipt: Readonly<VoltsRideRangeReceipt>,
): ProgressChange<ProgressOutboxRow> {
  const confirmed = storedProgressRow(existing, candidate, receipt);

  const unchanged =
    existing?.state.kind === "stored" && existing.state.receipt.entryId === receipt.entryId;

  return { value: confirmed, puts: unchanged ? [] : [confirmed] };
}

function deleteStoredProgressChange(
  rows: readonly ProgressOutboxRow[],
  stored: Readonly<ProgressOutboxRow>,
  receipt: Readonly<VoltsRideRangeReceipt>,
): ProgressChange<undefined> {
  const existing = findProgressRow(rows, stored);

  if (existing === undefined) return { value: undefined };

  if (existing.state.kind !== "stored" || existing.state.receipt.entryId !== receipt.entryId) {
    throw progressError("conflict", "Progress-Quittung wurde geändert.");
  }

  return { value: undefined, deletes: [existing] };
}

export async function runProgressMarkStored(
  database: Readonly<ProgressIndexedDatabase>,
  input: Readonly<ProgressMarkStored>,
): Promise<ProgressOutboxRow> {
  const fence = normalizeProgressFence(input.fence);
  const candidate = ProgressOutboxRowSchema.parse(input.row);
  const receipt = VoltsRideRangeReceiptSchema.parse(input.receipt);
  checkProgressFence(fence);
  checkProgressRow(candidate, fence);

  if (candidate.phase !== "sealed") {
    throw progressError("contract", "Nur versiegelte Progress-Batches können bestätigt werden.");
  }

  if (!progressReceiptCoversRow(receipt, candidate)) {
    throw progressError("contract", "Progress-Quittung deckt den Batch nicht ab.");
  }

  const stored = await runProgressKeyedChange(
    database,
    "readwrite",
    fence,
    [...progressOutboxKey(candidate)],
    (rows) => storeProgressChange(findProgressRow(rows, candidate), candidate, receipt),
  );

  await runProgressKeyedChange(
    database,
    "readwrite",
    fence,
    [...progressOutboxKey(stored)],
    (rows) => deleteStoredProgressChange(rows, stored, receipt),
  );

  return stored;
}
