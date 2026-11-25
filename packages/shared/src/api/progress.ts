import { z } from "zod";

import { VoltsRideRangeReceiptSchema } from "../economy.js";
import {
  RideProgressCheckpointSchema,
  type RideProgressCheckpoint,
  type RideProgressMetadata,
} from "../rideProgress.js";

const maxCheckpointCount = 1200;
const maxFactCount = 1200;

export const ProgressSessionGenerationSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const ProgressConsentStateSchema = z
  .object({
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    enabled: z.boolean(),
    rewardsAvailable: z.boolean(),
    sessionGeneration: ProgressSessionGenerationSchema,
  })
  .strict()
  .readonly();

export const ProgressConsentUpdateSchema = z
  .object({
    enabled: z.boolean(),
    sessionGeneration: ProgressSessionGenerationSchema,
  })
  .strict()
  .readonly();

function hasSamePhysics(
  left: RideProgressMetadata["physics"],
  right: RideProgressMetadata["physics"],
): boolean {
  return (
    left.massKg === right.massKg &&
    left.bikeMassKg === right.bikeMassKg &&
    left.cdaM2 === right.cdaM2 &&
    left.crr === right.crr &&
    left.wheelCircM === right.wheelCircM
  );
}

function hasSameImmutableMetadata(
  left: RideProgressMetadata,
  right: RideProgressMetadata,
): boolean {
  return (
    left.source === right.source &&
    left.clockScale === right.clockScale &&
    left.physicsRevision === right.physicsRevision &&
    left.routeId === right.routeId &&
    left.routeRevision === right.routeRevision &&
    hasSamePhysics(left.physics, right.physics)
  );
}

function validateContinuation(
  previous: Readonly<RideProgressCheckpoint>,
  checkpoint: Readonly<RideProgressCheckpoint>,
  index: number,
  ctx: Pick<z.RefinementCtx, "addIssue">,
): void {
  if (checkpoint.journalId !== previous.journalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Progress checkpoints must belong to one journal",
      path: ["checkpoints", index, "journalId"],
    });
  }

  if (!hasSameImmutableMetadata(previous, checkpoint)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Progress checkpoint metadata must remain unchanged within a batch",
      path: ["checkpoints", index],
    });
  }

  if (checkpoint.sequence !== previous.sequence + 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Progress checkpoint sequence must increase by one",
      path: ["checkpoints", index, "sequence"],
    });
  }

  if (checkpoint.startTick !== previous.endTick) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Progress checkpoints must be contiguous",
      path: ["checkpoints", index, "startTick"],
    });
  }

  if (checkpoint.startedAtMs < previous.endedAtMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Progress checkpoint start time must not precede the previous end time",
      path: ["checkpoints", index, "startedAtMs"],
    });
  }
}

function validateBatch(
  batch: Readonly<{ checkpoints: readonly RideProgressCheckpoint[] }>,
  ctx: Pick<z.RefinementCtx, "addIssue">,
): void {
  let totalFacts = 0;
  let previous: RideProgressCheckpoint | undefined;

  for (const [index, checkpoint] of batch.checkpoints.entries()) {
    totalFacts += checkpoint.facts.length;

    if (totalFacts > maxFactCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Progress batch must contain at most 1200 facts",
        path: ["checkpoints"],
      });

      return;
    }

    if (previous === undefined) previous = checkpoint;
    else validateContinuation(previous, checkpoint, index, ctx);
    previous = checkpoint;
  }
}

export const ProgressCheckpointBatchSchema = z
  .object({
    consentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sessionGeneration: ProgressSessionGenerationSchema,
    checkpoints: z.array(RideProgressCheckpointSchema).min(1).max(maxCheckpointCount).readonly(),
  })
  .strict()
  .readonly()
  .superRefine(validateBatch);

export const ProgressRangeResponseSchema = z
  .object({ range: VoltsRideRangeReceiptSchema })
  .strict()
  .readonly();

export type ProgressSessionGeneration = z.infer<typeof ProgressSessionGenerationSchema>;

export type ProgressConsentState = z.infer<typeof ProgressConsentStateSchema>;

export type ProgressConsentUpdate = z.infer<typeof ProgressConsentUpdateSchema>;

export type ProgressCheckpointBatch = z.infer<typeof ProgressCheckpointBatchSchema>;

export type ProgressRangeResponse = z.infer<typeof ProgressRangeResponseSchema>;
