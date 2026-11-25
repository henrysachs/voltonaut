import {
  HealthResponseSchema,
  ProgressCheckpointBatchSchema,
  ProgressSessionGenerationSchema,
  RideProgressCheckpointSchema,
  isProgressCheckpointContinuation,
  type ProgressCheckpointBatch,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";

import {
  LOCAL_PROGRESS_MAX_CHECKPOINTS,
  LOCAL_PROGRESS_MAX_FACTS,
  LOCAL_PROGRESS_MAX_TIME_S,
  SERVER_PROGRESS_MAX_FACTS,
  SERVER_PROGRESS_MAX_TIME_S,
  type ProgressBatch,
  type ProgressIssueContext,
} from "./progressBatchTypes.js";

export const PROGRESS_TIME_EPSILON_S = 1e-9;
const integer = HealthResponseSchema.shape.uptimeS.int().max(Number.MAX_SAFE_INTEGER);
const envelope = HealthResponseSchema.pick({});

function validateContinuation(
  batch: Readonly<ProgressCheckpointBatch>,
  ctx: ProgressIssueContext,
): void {
  let previous: RideProgressCheckpoint | undefined;

  for (const [index, checkpoint] of batch.checkpoints.entries()) {
    if (previous !== undefined && !isProgressCheckpointContinuation(previous, checkpoint)) {
      ctx.addIssue({
        code: "custom",
        message: "Progress checkpoints must be contiguous",
        path: ["checkpoints", index],
      });
    }

    previous = checkpoint;
  }
}

function progressBatchSchema(maxFacts: number, maxTimeS: number, maxCheckpoints: number) {
  return envelope
    .extend({
      consentVersion: integer.positive(),
      sessionGeneration: ProgressSessionGenerationSchema,
      checkpoints: RideProgressCheckpointSchema.array().min(1).max(maxCheckpoints).readonly(),
    })
    .strict()
    .readonly()
    .superRefine((batch: Readonly<ProgressCheckpointBatch>, ctx: ProgressIssueContext) => {
      if (progressFactCount(batch) > maxFacts) {
        ctx.addIssue({
          code: "custom",
          message: `Progress batch must contain at most ${maxFacts} facts`,
          path: ["checkpoints"],
        });
      }

      if (progressSimulatedTimeS(batch) > maxTimeS + PROGRESS_TIME_EPSILON_S) {
        ctx.addIssue({
          code: "custom",
          message: `Progress batch must span at most ${maxTimeS} simulated seconds`,
          path: ["checkpoints"],
        });
      }

      if (batch.checkpoints.some((checkpoint) => checkpoint.source !== "ble")) {
        ctx.addIssue({
          code: "custom",
          message: "Progress batches only accept BLE checkpoints",
          path: ["checkpoints"],
        });
      }

      validateContinuation(batch, ctx);
    });
}

export const LocalProgressBatchSchema = progressBatchSchema(
  LOCAL_PROGRESS_MAX_FACTS,
  LOCAL_PROGRESS_MAX_TIME_S,
  LOCAL_PROGRESS_MAX_CHECKPOINTS,
);

export const ServerProgressBatchSchema = progressBatchSchema(
  SERVER_PROGRESS_MAX_FACTS,
  SERVER_PROGRESS_MAX_TIME_S,
  SERVER_PROGRESS_MAX_FACTS,
);

export function progressFactCount(batch: ProgressBatch): number {
  let total = 0;

  for (const checkpoint of batch.checkpoints) total += checkpoint.facts.length;

  return total;
}

export function progressSimulatedTimeS(batch: ProgressBatch): number {
  let totalS = 0;

  for (const checkpoint of batch.checkpoints) {
    for (const fact of checkpoint.facts) totalS += fact.timeS;
  }

  return totalS;
}

export function progressBatchStartTick(batch: ProgressBatch): number {
  const first = batch.checkpoints[0];

  if (first === undefined) throw new Error("Progress batch must contain a checkpoint");

  return first.startTick;
}

export function progressBatchEndTick(batch: ProgressBatch): number {
  const last = batch.checkpoints.at(-1);

  if (last === undefined) throw new Error("Progress batch must contain a checkpoint");

  return last.endTick;
}

export function assertProgressCheckpointContinuation(
  previous: RideProgressCheckpoint,
  checkpoint: RideProgressCheckpoint,
  consentVersion: number,
  sessionGeneration: number,
): void {
  ProgressCheckpointBatchSchema.parse({
    consentVersion,
    sessionGeneration,
    checkpoints: [previous, checkpoint],
  });
}
