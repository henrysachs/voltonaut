import { z } from "zod";

import { MAX_LOCAL_RIDE_MS } from "../localRide.js";
import { RiderProfileSchema } from "../profile.js";
import { RideRecordingSchema } from "../recordingCapture.js";
import { UserSchema } from "./auth.js";
import { MembershipSchema, AuthorizationSchema } from "./account-status.js";
import { RideAssessmentSchema, RideReceiptSchema, ReplayWindowSummarySchema } from "./rides.js";
import { StravaDeliverySchema, StravaStatusSchema } from "./strava.js";

export const ProfileInputSchema = RiderProfileSchema.extend({
  bike: RiderProfileSchema.shape.bike.strict(),
}).strict();

export const PresentProfileSchema = z
  .object({
    status: z.literal("present"),
    profile: ProfileInputSchema,
    updatedAt: z.string().datetime({ precision: 3 }),
  })
  .strict();

export const ProfileStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing") }).strict(),
  PresentProfileSchema,
]);

export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export type PresentProfile = z.infer<typeof PresentProfileSchema>;

export type ProfileState = z.infer<typeof ProfileStateSchema>;

export const AccountDeletionRequestSchema = z
  .object({
    confirmation: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

export type AccountDeletionRequest = z.infer<typeof AccountDeletionRequestSchema>;

export const AccountDeletionResponseSchema = z.null();

export const AccountDataOwnerSchema = z
  .object({
    apiOrigin: z
      .string()
      .max(512)
      .regex(/^https?:\/\/[^\s/?#@]+$/iu),
    userId: UserSchema.shape.id,
  })
  .strict();

export type AccountDataOwner = z.infer<typeof AccountDataOwnerSchema>;

const NotStoredSchema = z.object({ status: z.literal("not_stored") }).strict();

const AccountExportRideSchema = z
  .object({
    recording: RideRecordingSchema,
    receipt: RideReceiptSchema,
    assessment: RideAssessmentSchema,
    stored: z
      .object({
        uploadedAt: z.string().datetime({ precision: 3 }),
        durationMs: z.number().int().min(1000).max(MAX_LOCAL_RIDE_MS),
        distanceM: z.number().finite().nonnegative().max(10_000_000),
        source: z.enum(["sim", "ble"]),
        replaySummary: ReplayWindowSummarySchema.nullable(),
        tcx: z
          .object({
            version: z.literal("tcx-1"),
            hash: z.string().regex(/^[a-f0-9]{64}$/u),
            content: z.string(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict();

export const AccountExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: z.string().datetime({ precision: 3 }),
    account: z
      .object({
        user: UserSchema,
        membership: MembershipSchema,
        authorization: AuthorizationSchema,
      })
      .strict(),
    profile: ProfileStateSchema,
    rides: z.array(AccountExportRideSchema),
    inventory: NotStoredSchema,
    progression: NotStoredSchema,
    strava: z
      .object({
        status: StravaStatusSchema,
        deliveries: z.array(StravaDeliverySchema),
      })
      .strict(),
  })
  .strict();

export type AccountExport = z.infer<typeof AccountExportSchema>;
