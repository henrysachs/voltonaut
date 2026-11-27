/* oxlint-disable typescript/prefer-readonly-parameter-types -- Delivery inputs are readonly contracts; Oxlint does not follow imported aliases. */
import {
  checkProgressFence,
  normalizeProgressFence,
  progressError,
} from "./progressOutboxFence.js";
import { runProgressKeyedChange } from "./progressOutboxChange.js";
import {
  PROGRESS_OUTBOX_MAX_ATTEMPTS,
  ProgressOutboxRowSchema,
  type ProgressBlockCause,
  type ProgressOutboxRow,
  type ProgressOutboxState,
} from "./progressOutboxSchema.js";
import type {
  ProgressMarkBlocked,
  ProgressMarkSending,
  ProgressWriteFence,
} from "./progressOutbox.js";
import {
  checkProgressRow,
  findProgressRow,
  replaceProgressState,
  sameProgressBatch,
} from "./progressOutboxRows.js";
import { progressOutboxKey } from "./progressOutboxRow.js";
import type { ProgressIndexedDatabase } from "./progressOutboxIndexedTypes.js";

export { runProgressMarkStored } from "./progressOutboxStored.js";

export { runProgressView } from "./progressOutboxView.js";

export function progressFailureState(
  attempts: number,
  cause: ProgressBlockCause,
  nowMs: number,
): Exclude<ProgressOutboxState, { kind: "stored" }> {
  const retryAtMs = nowMs + Math.min(60_000, 1000 * 2 ** (attempts - 1));

  return cause === "retry" && attempts < PROGRESS_OUTBOX_MAX_ATTEMPTS
    ? { kind: "queued", attempts, retryAtMs }
    : { kind: "blocked", cause, attempts, retryAtMs };
}

function sendingProgressRow(
  existing: Readonly<ProgressOutboxRow>,
  input: Readonly<ProgressMarkSending>,
): ProgressOutboxRow {
  if (existing.phase !== "sealed") {
    throw progressError("contract", "Nur versiegelte Progress-Batches können gesendet werden.");
  }

  if (existing.state.kind === "sending") return existing;

  if (existing.state.kind === "stored") {
    throw progressError("contract", "Progress-Batch ist bereits bestätigt.");
  }

  if (existing.state.kind === "queued") {
    if (existing.state.retryAtMs > input.nowMs && !input.manual) return existing;

    return replaceProgressState(existing, {
      kind: "sending",
      attempts: existing.state.attempts + 1,
      retryAtMs: 0,
    });
  }

  if (!input.manual || (existing.state.cause !== "retry" && existing.state.cause !== "reauth")) {
    throw progressError("conflict", "Blockierter Progress-Batch braucht einen expliziten Retry.");
  }

  return replaceProgressState(existing, { kind: "sending", attempts: 1, retryAtMs: 0 });
}

function requeueProgressRow(
  existing: Readonly<ProgressOutboxRow>,
  nowMs: number,
): ProgressOutboxRow {
  if (existing.phase !== "sealed") {
    throw progressError(
      "contract",
      "Nur versiegelte Progress-Batches können erneut eingereiht werden.",
    );
  }

  if (existing.state.kind === "queued") return existing;

  if (existing.state.kind !== "sending") {
    throw progressError(
      "contract",
      "Nur sendende Progress-Batches können erneut eingereiht werden.",
    );
  }

  return replaceProgressState(existing, {
    kind: "queued",
    attempts: existing.state.attempts,
    retryAtMs: nowMs,
  });
}

export function runProgressRequeue(
  database: Readonly<ProgressIndexedDatabase>,
  row: Readonly<ProgressOutboxRow>,
  fenceInput: Readonly<ProgressWriteFence>,
  nowMs: number,
): Promise<ProgressOutboxRow> {
  const fence = normalizeProgressFence(fenceInput);
  const candidate = ProgressOutboxRowSchema.parse(row);
  checkProgressFence(fence);
  checkProgressRow(candidate, fence);

  return runProgressKeyedChange(
    database,
    "readwrite",
    fence,
    [...progressOutboxKey(candidate)],
    (rows) => {
      const existing = findProgressRow(rows, candidate);

      if (existing === undefined || !sameProgressBatch(existing.payload, candidate.payload)) {
        throw progressError("conflict", "Progress-Batch wurde geändert oder entfernt.");
      }

      const queued = requeueProgressRow(existing, nowMs);

      return { value: queued, puts: queued.revision === existing.revision ? [] : [queued] };
    },
  );
}

export function runProgressMarkBlocked(
  database: Readonly<ProgressIndexedDatabase>,
  input: Readonly<ProgressMarkBlocked>,
): Promise<ProgressOutboxRow> {
  const fence = normalizeProgressFence(input.fence);
  const candidate = ProgressOutboxRowSchema.parse(input.row);
  checkProgressFence(fence, true);
  checkProgressRow(candidate, fence);

  return runProgressKeyedChange(
    database,
    "readwrite",
    fence,
    [...progressOutboxKey(candidate)],
    (rows) => {
      const existing = findProgressRow(rows, candidate);

      if (
        existing === undefined ||
        !sameProgressBatch(existing.payload, candidate.payload) ||
        existing.state.kind === "stored" ||
        input.attempts !== existing.state.attempts ||
        input.attempts < 1 ||
        input.attempts > PROGRESS_OUTBOX_MAX_ATTEMPTS
      ) {
        throw progressError("conflict", "Progress-Status oder Versuchszahl passt nicht mehr.");
      }

      const blocked = replaceProgressState(
        existing,
        progressFailureState(input.attempts, input.cause, input.nowMs),
      );

      return { value: blocked, puts: [blocked] };
    },
  );
}

export function runProgressMarkSending(
  database: Readonly<ProgressIndexedDatabase>,
  input: Readonly<ProgressMarkSending>,
): Promise<ProgressOutboxRow> {
  const fence = normalizeProgressFence(input.fence);
  const candidate = ProgressOutboxRowSchema.parse(input.row);
  checkProgressFence(fence, true);
  checkProgressRow(candidate, fence);

  return runProgressKeyedChange(
    database,
    "readwrite",
    fence,
    [...progressOutboxKey(candidate)],
    (rows) => {
      const existing = findProgressRow(rows, candidate);

      if (existing === undefined) {
        throw progressError("missing", "Progress-Batch ist nicht mehr vorhanden.");
      }

      if (!sameProgressBatch(existing.payload, candidate.payload)) {
        throw progressError("conflict", "Progress-Batch wurde geändert.");
      }

      const sending = sendingProgressRow(existing, input);

      return { value: sending, puts: sending.revision === existing.revision ? [] : [sending] };
    },
  );
}
