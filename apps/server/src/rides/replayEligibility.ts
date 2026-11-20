import type { RecordingV2 } from "@voltonaut/shared";

export type ReplayIneligibilityReason =
  | "capture_not_verified"
  | "incomplete_journal"
  | "sim"
  | "clock_scale"
  | "trainer_disconnect"
  | "trainer_not_ready"
  | "stale_trainer"
  | "delayed_capture"
  | "gap"
  | "clock_skipped";

export interface ReplayEligibility {
  readonly status: "ineligible";
  readonly reasons: readonly ReplayIneligibilityReason[];
}

function metadataReasons(
  recording: RecordingV2,
  evidence: { readonly staleTrainer: boolean; readonly clockSkipped: boolean },
): Set<ReplayIneligibilityReason> {
  const reasons = new Set<ReplayIneligibilityReason>(["capture_not_verified"]);

  if (recording.journalState !== "complete") reasons.add("incomplete_journal");

  if (recording.initialization.source === "sim") reasons.add("sim");

  if (recording.initialization.clockScale !== 1) reasons.add("clock_scale");

  if (evidence.staleTrainer) reasons.add("stale_trainer");

  if (evidence.clockSkipped) reasons.add("clock_skipped");

  if (recording.observations.some((observation) => observation.gap)) reasons.add("gap");

  return reasons;
}

/** Local consistency is not permission to send an activity to an external provider. */
export function recordingV2Eligibility(
  recording: RecordingV2,
  evidence: { readonly staleTrainer: boolean; readonly clockSkipped: boolean },
): ReplayEligibility {
  const reasons = metadataReasons(recording, evidence);
  let ready = false;
  let powerAtMs: number | undefined;
  let cadenceAtMs: number | undefined;
  let lastBoundaryMs: number | undefined;

  for (const entry of recording.entries) {
    if (entry[2] === "status" && entry[3] === "trainer") {
      ready = entry[4] === "ready";

      if (!ready) reasons.add("trainer_disconnect");
    }

    if (entry[2] === "advance") {
      if (!ready) reasons.add("trainer_not_ready");

      if (entry[3] > 2.5) reasons.add("gap");

      if (
        powerAtMs === undefined ||
        cadenceAtMs === undefined ||
        entry[1] - powerAtMs > 2500 ||
        entry[1] - cadenceAtMs > 2500
      )
        reasons.add("stale_trainer");
    }

    if (entry[2] === "trainer") {
      if (entry[3] !== null) powerAtMs = entry[1];

      if (entry[4] !== null) cadenceAtMs = entry[1];
    }

    if (entry[2] === "boundary") {
      if (entry[3] === "start" && entry[1] !== recording.initialization.initializedWorkerMs) {
        reasons.add("delayed_capture");
      }

      if (lastBoundaryMs !== undefined && entry[1] - lastBoundaryMs > 2500) reasons.add("gap");
      lastBoundaryMs = entry[1];
    }
  }

  return { status: "ineligible", reasons: [...reasons] };
}
