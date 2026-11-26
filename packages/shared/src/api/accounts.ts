import { z } from "zod";

import { MAX_LOCAL_RIDE_MS } from "../localRide.js";
import { RiderProfileSchema } from "../profile.js";
import { RideRecordingSchema } from "../recordingCapture.js";
import { UserSchema } from "./auth.js";
import { MembershipSchema, AuthorizationSchema } from "./account-status.js";
import { ProgressionAccountExportSchema } from "./progress.js";
import { RideAssessmentSchema, RideReceiptSchema, ReplayWindowSummarySchema } from "./rides.js";
import { InventoryAccountExportSchema } from "./shop.js";
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

/**
 * Outcome of the Strava revocation that runs before the deletion (issue #140). `failed` still
 * deletes the account; the rider then removes Voltonaut in the Strava settings.
 */
export const StravaRevocationOutcomeSchema = z.enum(["revoked", "not_connected", "failed"]);

export const AccountDeletionResponseSchema = z
  .object({ stravaRevocation: StravaRevocationOutcomeSchema })
  .strict();

export type AccountDeletionResponse = z.infer<typeof AccountDeletionResponseSchema>;

export type StravaRevocationOutcome = z.infer<typeof StravaRevocationOutcomeSchema>;

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
    schemaVersion: z.literal(4),
    exportedAt: z.string().datetime({ precision: 3 }),
    account: z
      .object({
        user: UserSchema,
        membership: MembershipSchema,
        authorization: AuthorizationSchema,
        identities: z.array(
          z
            .object({
              issuer: z.string().url().max(2048),
              subject: z.string().min(1).max(1024),
            })
            .strict(),
        ),
      })
      .strict(),
    profile: ProfileStateSchema,
    rides: z.array(AccountExportRideSchema),
    inventory: InventoryAccountExportSchema,
    progression: ProgressionAccountExportSchema,
    strava: z
      .object({
        status: StravaStatusSchema,
        deliveries: z.array(StravaDeliverySchema),
      })
      .strict(),
  })
  .strict();

export type AccountExport = z.infer<typeof AccountExportSchema>;
