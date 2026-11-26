import { z } from "zod";

import { MAX_LOCAL_RIDE_MS } from "../localRide.js";
import { RideRecordingSchema } from "../recordingCapture.js";

const nonnegative = z.number().finite().nonnegative();

/** Replay revision of world path recordings; a new path semantics needs a new revision. */
export const WORLD_PATH_REPLAY_REVISION = "world-path-1";

export const WindowFailureSchema = z.enum([
  "sim",
  "clock_scale",
  "trainer_not_ready",
  "trainer_disconnect",
  "stale_trainer",
  "gap",
  "clock_skipped",
]);

export const WindowQualitySchema = z.union([
  z
    .object({ kind: z.literal("continuous") })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal("blocked"),
      reasons: z.tuple([WindowFailureSchema]).rest(WindowFailureSchema).readonly(),
    })
    .strict()
    .readonly(),
]);

export const SourceAssessmentSchema = z
  .object({
    assurance: z.literal("client_declared"),
    declaredSource: z.enum(["sim", "ble"]),
    window: WindowQualitySchema,
  })
  .strict()
  .readonly();

export const ReplayWindowSummarySchema = z
  .object({
    elapsedRealS: nonnegative,
    distanceM: nonnegative,
    elevationGainM: nonnegative,
    energyKj: nonnegative,
    tS: nonnegative,
    laps: nonnegative.int(),
    eventCount: nonnegative.int(),
    commandCount: nonnegative.int(),
  })
  .strict()
  .readonly();

export const RideAssessmentSchema = z.union([
  z
    .object({
      status: z.literal("unverified"),
      reason: z.enum(["legacy_missing_replay", "incomplete_journal", "unknown_revision"]),
    })
    .strict()
    .readonly(),
  z
    .object({ status: z.literal("rejected"), reason: z.literal("observation_mismatch") })
    .strict()
    .readonly(),
  // Single-route replay (ADR-016); stored assessments keep this form.
  z
    .object({
      status: z.literal("replayed"),
      physicsRevision: z.literal("engine-v1"),
      summary: ReplayWindowSummarySchema,
      source: SourceAssessmentSchema,
    })
    .strict()
    .readonly(),
  // World path replay (ADR-033 §7): the server resolves world and revision itself.
  z
    .object({
      status: z.literal("replayed"),
      physicsRevision: z.literal("engine-v1"),
      replayRevision: z.literal(WORLD_PATH_REPLAY_REVISION),
      summary: ReplayWindowSummarySchema,
      source: SourceAssessmentSchema,
    })
    .strict()
    .readonly(),
]);

export const RideIdSchema = z.string().uuid().toLowerCase();

export const RideUploadSchema = RideRecordingSchema.transform((recording) => ({
  ...recording,
  rideId: RideIdSchema.parse(recording.rideId),
})).readonly();

export const RideReceiptSchema = z
  .object({
    rideId: RideIdSchema,
    storage: z.literal("stored"),
    assessment: RideAssessmentSchema,
  })
  .strict();

export const RideDetailSchema = z
  .object({
    recording: RideRecordingSchema,
    assessment: RideAssessmentSchema,
  })
  .strict();

export const RideSummarySchema = z
  .object({
    rideId: RideIdSchema,
    startedAt: z.string().datetime({ precision: 3 }),
    uploadedAt: z.string().datetime({ precision: 3 }),
    durationMs: z.number().int().min(1000).max(MAX_LOCAL_RIDE_MS),
    distanceM: z.number().finite().nonnegative().max(10_000_000),
    source: z.enum(["sim", "ble"]),
    assessment: RideAssessmentSchema,
  })
  .strict();

export const RideListQuerySchema = z
  .object({
    cursor: RideIdSchema.optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d?$/u)
      .transform(Number)
      .pipe(z.number().max(50))
      .default("20"),
  })
  .strict();

export const RideListSchema = z
  .object({
    rides: z.array(RideSummarySchema).max(50),
    nextCursor: RideIdSchema.nullable(),
  })
  .strict();

export type RideAssessment = z.infer<typeof RideAssessmentSchema>;

export type WindowFailure = z.infer<typeof WindowFailureSchema>;

export type WindowQuality = z.infer<typeof WindowQualitySchema>;

export type SourceAssessment = z.infer<typeof SourceAssessmentSchema>;

export type ReplayWindowSummary = z.infer<typeof ReplayWindowSummarySchema>;

export type RideUpload = z.infer<typeof RideUploadSchema>;

export type RideReceipt = z.infer<typeof RideReceiptSchema>;

export type RideDetail = z.infer<typeof RideDetailSchema>;

export type RideListQuery = z.infer<typeof RideListQuerySchema>;

export type RideList = z.infer<typeof RideListSchema>;
