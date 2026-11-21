import { createHash } from "node:crypto";
import {
  projectRecordingTrack,
  RideAssessmentSchema,
  serializeRideTcx,
  type RideAssessment,
  type RideRecording,
  type RideTrack,
} from "@voltonaut/shared";

import { ApiError } from "../api-error.js";
import { assessRecordingV2 } from "./replay.js";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface AdmittedRecording {
  readonly assessment: RideAssessment;
  readonly track: RideTrack;
}

function admittedRecording(recording: RideRecording): AdmittedRecording {
  if (recording.schemaVersion === 1) {
    return {
      assessment: { status: "unverified", reason: "legacy_missing_replay" },
      track: recording,
    };
  }

  // The strict envelope permits finite observations beyond the bounded export track.
  // Fail closed rather than persist a misleading summary or turn projection failures into 500s.
  try {
    const assessment = RideAssessmentSchema.parse(assessRecordingV2(recording));
    const track = projectRecordingTrack(recording);

    return { assessment, track };
  } catch {
    throw new ApiError(422, "validation_failed", "recording cannot produce a bounded ride track");
  }
}

/** Expensive replay/projection happens before the short final immutable insert transaction. */
export function prepareRide(userId: string, recording: RideRecording, nowMs: number) {
  const { assessment, track } = admittedRecording(recording);
  const last = track.samples.at(-1);

  if (last === undefined) throw new ApiError(422, "validation_failed", "recording has no samples");
  const exportTcx = assessment.status === "replayed" ? serializeRideTcx(track) : null;
  const exportVersion: "tcx-1" | null = exportTcx === null ? null : "tcx-1";

  return {
    id: recording.rideId,
    userId,
    receiptJson: JSON.stringify({ rideId: recording.rideId, storage: "stored", assessment }),
    assessmentJson: JSON.stringify(assessment),
    summaryJson: assessment.status === "replayed" ? JSON.stringify(assessment.summary) : null,
    exportTcx,
    exportHash: exportTcx === null ? null : sha256(exportTcx),
    exportVersion,
    startedAt: track.startedAt,
    uploadedAt: nowMs,
    durationMs: last.elapsedMs,
    distanceM: assessment.status === "replayed" ? assessment.summary.distanceM : last.distanceM,
    source: track.metadata.source,
  };
}
