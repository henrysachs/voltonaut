import { z } from "zod";

import { CompletedLocalRideSchema, MAX_LOCAL_RIDE_MS } from "../localRide.js";

export const RideAssessmentSchema = z
  .object({
    status: z.literal("unverified"),
    reason: z.literal("legacy_missing_replay"),
  })
  .strict();

export const RideIdSchema = z.string().uuid().toLowerCase();

export const RideUploadSchema = CompletedLocalRideSchema.transform((recording) => ({
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
    recording: CompletedLocalRideSchema,
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

export type RideUpload = z.infer<typeof RideUploadSchema>;

export type RideReceipt = z.infer<typeof RideReceiptSchema>;

export type RideDetail = z.infer<typeof RideDetailSchema>;

export type RideListQuery = z.infer<typeof RideListQuerySchema>;

export type RideList = z.infer<typeof RideListSchema>;
