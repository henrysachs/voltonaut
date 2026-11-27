import { z } from "zod";

import { RiderProfileSchema } from "./profile.js";
import { withRideReference } from "./rideReference.js";

export const MAX_LOCAL_RIDE_MS = 6 * 60 * 60 * 1000;
export const MAX_LOCAL_RIDES = 20;

const referenceText = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}\p{Cs}\uFFFE\uFFFF]+$/u);

/** New tracks name a world path; stored single-route tracks stay readable (ADR-033 §7). */
export const LocalRideMetadataSchema = withRideReference(
  { source: z.enum(["sim", "ble"]) },
  {
    physicsClockScale: z.number().finite().min(1).max(20),
    profile: RiderProfileSchema.extend({
      bike: RiderProfileSchema.shape.bike.strict().readonly(),
    })
      .strict()
      .readonly(),
  },
  referenceText,
);

export const LocalRidePointSchema = z
  .object({
    elapsedMs: z.number().int().min(0).max(MAX_LOCAL_RIDE_MS),
    distanceM: z.number().finite().nonnegative().max(10_000_000),
    powerW: z.number().finite().min(0).max(2000).optional(),
    cadenceRpm: z.number().finite().min(0).max(200).optional(),
    hrBpm: z.number().finite().min(1).max(250).optional(),
    gap: z.boolean(),
  })
  .strict()
  .readonly();

const track = z
  .object({
    rideId: z.string().uuid(),
    startedAt: z.string().datetime({ precision: 3 }),
    metadata: LocalRideMetadataSchema,
    samples: z.array(LocalRidePointSchema).min(2).max(21_602).readonly(),
  })
  .strict();

function validateTrack(
  ride: Readonly<z.infer<typeof track>>,
  context: Pick<z.RefinementCtx, "addIssue">,
): void {
  let previousTime = -1;
  let previousDistance = 0;
  let hasReading = false;

  for (const point of ride.samples) {
    if (point.elapsedMs <= previousTime || point.distanceM < previousDistance) {
      context.addIssue({ code: "custom", message: "Samples müssen monoton sein" });
    }

    if (previousTime >= 0 && point.elapsedMs - previousTime > 2500 && !point.gap) {
      context.addIssue({ code: "custom", message: "Zeitlücke muss markiert sein" });
    }

    if ((point.powerW === undefined || point.cadenceRpm === undefined) && !point.gap) {
      context.addIssue({ code: "custom", message: "Fehlende Trainerdaten müssen markiert sein" });
    }

    previousTime = point.elapsedMs;

    previousDistance = point.distanceM;

    hasReading ||= point.powerW !== undefined || point.cadenceRpm !== undefined;
  }

  const first = ride.samples[0];

  if (first?.elapsedMs !== 0 || first.distanceM !== 0 || previousTime < 1000 || !hasReading) {
    context.addIssue({ code: "custom", message: "Aufnahme ist leer oder unvollständig" });
  }
}

export const RideTrackSchema = track.superRefine(validateTrack).readonly();

export const CompletedLocalRideSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...track.shape,
  })
  .strict()
  .superRefine(validateTrack)
  .readonly();

export type LocalRideMetadata = z.infer<typeof LocalRideMetadataSchema>;

export type LocalRidePoint = z.infer<typeof LocalRidePointSchema>;

export type RideTrack = z.infer<typeof RideTrackSchema>;

export type CompletedLocalRide = z.infer<typeof CompletedLocalRideSchema>;
