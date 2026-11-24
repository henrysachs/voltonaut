import { z } from "zod";

import { CompletedLocalRideSchema, RideTrackSchema, type RideTrack } from "./localRide.js";
import { RecordingV2Schema } from "./recordingV2.js";
import { projectRecordingTrack } from "./recordingTrack.js";

export const CaptureUnavailabilityReasonSchema = z.enum([
  "journal_bytes",
  "journal_inputs",
  "journal_advances",
  "journal_observations",
  "journal_age",
  "invalid_input",
  // A ride mode without journal replay was entered in this session (ADR-028).
  "ride_mode",
]);

const journal = z
  .object({ kind: z.literal("journal"), recording: RecordingV2Schema })
  .strict()
  .readonly();

const local = z
  .object({
    kind: z.literal("local_only"),
    reason: CaptureUnavailabilityReasonSchema,
    track: RideTrackSchema,
  })
  .strict()
  .readonly();

export const CapturedRideSchema = z.union([journal, local]);

export const ArchivedRideSchema = z.union([
  journal,
  local,
  z
    .object({ kind: z.literal("legacy"), recording: CompletedLocalRideSchema })
    .strict()
    .readonly(),
]);

export const RideRecordingSchema = z.union([RecordingV2Schema, CompletedLocalRideSchema]);

export type CaptureUnavailabilityReason = z.infer<typeof CaptureUnavailabilityReasonSchema>;

export type CapturedRide = z.infer<typeof CapturedRideSchema>;

export type ArchivedRide = z.infer<typeof ArchivedRideSchema>;

export type RideRecording = z.infer<typeof RideRecordingSchema>;

export function archivedRideTrack(ride: ArchivedRide): RideTrack {
  switch (ride.kind) {
    case "journal":
      return projectRecordingTrack(ride.recording);
    case "local_only":
      return ride.track;
    case "legacy": {
      const { rideId, startedAt, metadata, samples } = ride.recording;

      return { rideId, startedAt, metadata, samples };
    }

    default: {
      const exhaustive: never = ride;

      return exhaustive;
    }
  }
}
