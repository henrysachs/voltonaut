import { expect, it } from "vitest";

import { CompletedLocalRideSchema, RideTrackSchema } from "./localRide.js";
import {
  ArchivedRideSchema,
  CapturedRideSchema,
  RideRecordingSchema,
  archivedRideTrack,
} from "./recordingCapture.js";
import { projectRecordingTrack } from "./recordingTrack.js";
import { recordedRide } from "./testdata/recording.js";

it("keeps new journal captures and historical archive data distinct", () => {
  const recording = recordedRide();
  const journal = CapturedRideSchema.parse({ kind: "journal", recording });
  const track = projectRecordingTrack(recording);
  const legacyRecording = CompletedLocalRideSchema.parse({ schemaVersion: 1, ...track });

  const legacy = ArchivedRideSchema.parse({ kind: "legacy", recording: legacyRecording });

  expect(archivedRideTrack(journal)).toEqual(track);
  expect(archivedRideTrack(legacy)).toEqual(track);
  expect(JSON.stringify(legacy)).toBe(
    JSON.stringify({ kind: "legacy", recording: legacyRecording }),
  );
  expect(CapturedRideSchema.safeParse(legacy).success).toBe(false);
  expect(RideRecordingSchema.parse(recording)).toEqual(recording);
  expect(RideRecordingSchema.parse(legacyRecording)).toEqual(legacyRecording);
});

it("allows only explicitly local tracks after journal exhaustion", () => {
  const track = projectRecordingTrack(recordedRide());

  const capture = CapturedRideSchema.parse({
    kind: "local_only",
    reason: "journal_bytes",
    track,
  });

  expect(archivedRideTrack(capture)).toEqual(track);
  expect(RideRecordingSchema.safeParse(capture).success).toBe(false);
  expect(CapturedRideSchema.safeParse({ ...capture, recording: recordedRide() }).success).toBe(
    false,
  );
  expect(CapturedRideSchema.safeParse({ kind: "local_only", track }).success).toBe(false);
  expect(
    CapturedRideSchema.safeParse({ kind: "journal", recording: recordedRide(), reason: "gap" })
      .success,
  ).toBe(false);
});

it("does not give the shared track projection a legacy storage version", () => {
  const track = projectRecordingTrack(recordedRide());

  expect(RideTrackSchema.parse(track)).toEqual(track);
  expect(RideTrackSchema.safeParse({ ...track, schemaVersion: 1 }).success).toBe(false);
  expect(CompletedLocalRideSchema.safeParse(track).success).toBe(false);
});
