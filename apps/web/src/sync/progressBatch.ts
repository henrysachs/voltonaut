import type { RideProgressCheckpoint } from "@voltonaut/shared";

import {
  LOCAL_PROGRESS_MAX_CHECKPOINTS,
  LOCAL_PROGRESS_MAX_FACTS,
  LOCAL_PROGRESS_MAX_TIME_S,
  type ProgressBatch,
  type ProgressBatchAppendInput,
  type ProgressBatchUpdate,
} from "./progressBatchTypes.js";
import {
  LocalProgressBatchSchema,
  PROGRESS_TIME_EPSILON_S,
  assertProgressCheckpointContinuation,
  progressFactCount,
  progressSimulatedTimeS,
} from "./progressBatchSchema.js";

export {
  LOCAL_PROGRESS_MAX_CHECKPOINTS,
  LOCAL_PROGRESS_MAX_FACTS,
  LOCAL_PROGRESS_MAX_TIME_S,
  SERVER_PROGRESS_MAX_BATCHES,
  SERVER_PROGRESS_MAX_FACTS,
  SERVER_PROGRESS_MAX_TIME_S,
  type ProgressBatch,
  type ProgressBatchAppendInput,
  type ProgressBatchUpdate,
} from "./progressBatchTypes.js";

export {
  LocalProgressBatchSchema,
  ServerProgressBatchSchema,
  assertProgressCheckpointContinuation,
  progressBatchEndTick,
  progressBatchStartTick,
  progressFactCount,
  progressSimulatedTimeS,
} from "./progressBatchSchema.js";

export { groupProgressBatches } from "./progressBatchGroup.js";

function isFull(batch: ProgressBatch): boolean {
  return (
    progressFactCount(batch) >= LOCAL_PROGRESS_MAX_FACTS ||
    progressSimulatedTimeS(batch) >= LOCAL_PROGRESS_MAX_TIME_S - PROGRESS_TIME_EPSILON_S ||
    batch.checkpoints.length >= LOCAL_PROGRESS_MAX_CHECKPOINTS
  );
}

function fits(open: ProgressBatch, checkpoint: RideProgressCheckpoint): boolean {
  return (
    progressFactCount(open) + checkpoint.facts.length <= LOCAL_PROGRESS_MAX_FACTS &&
    progressSimulatedTimeS(open) +
      checkpoint.facts.reduce((total, fact) => total + fact.timeS, 0) <=
      LOCAL_PROGRESS_MAX_TIME_S + PROGRESS_TIME_EPSILON_S &&
    open.checkpoints.length < LOCAL_PROGRESS_MAX_CHECKPOINTS
  );
}

function combineBatch(
  open: ProgressBatch,
  next: RideProgressCheckpoint,
  template: ProgressBatch,
): ProgressBatch {
  return Object.freeze({
    consentVersion: template.consentVersion,
    sessionGeneration: template.sessionGeneration,
    checkpoints: Object.freeze([...open.checkpoints, next]),
  });
}

function batchUpdate(
  open: ProgressBatch | undefined,
  sealed: readonly ProgressBatch[] = [],
): ProgressBatchUpdate {
  if (open === undefined) {
    return Object.freeze({ sealed: Object.freeze(sealed), open });
  }

  const full = isFull(open);

  return Object.freeze({
    sealed: Object.freeze(full ? [...sealed, open] : sealed),
    open: full ? undefined : open,
  });
}

export function appendProgressBatch(input: ProgressBatchAppendInput): ProgressBatchUpdate {
  return appendValidatedProgressBatch({
    ...input,
    open: input.open === undefined ? undefined : LocalProgressBatchSchema.parse(input.open),
  });
}

/**
 * Same as `appendProgressBatch` for an open batch that already is a `LocalProgressBatchSchema`
 * output, such as the payload of a parsed outbox row. Only the new checkpoint is parsed, so one
 * append stays independent of the open batch size; combined outputs remain schema-valid.
 */
export function appendValidatedProgressBatch({
  open,
  checkpoint,
  consentVersion,
  sessionGeneration,
}: ProgressBatchAppendInput): ProgressBatchUpdate {
  const parsed = LocalProgressBatchSchema.parse({
    consentVersion,
    sessionGeneration,
    checkpoints: [checkpoint],
  });

  const next = parsed.checkpoints[0];

  if (next === undefined) throw new Error("Progress checkpoint is required");

  if (open === undefined) return batchUpdate(parsed);

  if (open.consentVersion !== consentVersion) {
    throw new Error("Open progress batch belongs to another consent version");
  }

  const previous = open.checkpoints.at(-1);

  if (previous === undefined) throw new Error("Progress batch must contain a checkpoint");
  assertProgressCheckpointContinuation(previous, next, consentVersion, sessionGeneration);

  if (!fits(open, next)) return batchUpdate(parsed, [open]);

  return batchUpdate(combineBatch(open, next, parsed));
}

export function sealProgressBatch(open: ProgressBatch | undefined): readonly ProgressBatch[] {
  return open === undefined ? [] : Object.freeze([LocalProgressBatchSchema.parse(open)]);
}
