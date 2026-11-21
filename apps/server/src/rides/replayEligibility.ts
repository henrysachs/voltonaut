import type {
  RecordingEntryV2,
  RecordingV2,
  SourceAssessment,
  WindowFailure,
} from "@voltonaut/shared";

class WindowAssessment {
  private readonly reasons = new Set<WindowFailure>();
  private ready = false;
  private powerAtMs: number | undefined;
  private cadenceAtMs: number | undefined;
  private inWindow = false;
  private lastBoundaryMs: number | undefined;

  private check(atMs: number): void {
    if (!this.ready) this.reasons.add("trainer_not_ready");

    if (
      this.powerAtMs === undefined ||
      this.cadenceAtMs === undefined ||
      atMs - this.powerAtMs > 2500 ||
      atMs - this.cadenceAtMs > 2500
    )
      this.reasons.add("stale_trainer");
  }

  ingest(entry: RecordingEntryV2): void {
    const atMs = entry[1];

    // Check before applying an update: a fresh input cannot heal its past interval.
    if (this.inWindow) this.check(atMs);

    if (entry[2] === "status" && entry[3] === "trainer") {
      this.ready = entry[4] === "ready";

      if (!this.ready) {
        this.powerAtMs = undefined;
        this.cadenceAtMs = undefined;

        if (this.inWindow) this.reasons.add("trainer_disconnect");
      }
    } else if (entry[2] === "trainer") {
      if (entry[3] !== null) this.powerAtMs = atMs;

      if (entry[4] !== null) this.cadenceAtMs = atMs;
    } else if (entry[2] === "advance" && this.inWindow && entry[3] > 2.5) {
      // Real advance can overlap start even when the last boundary was recent.
      this.reasons.add("gap");
    } else if (entry[2] === "boundary") {
      if (entry[3] === "start") {
        this.inWindow = true;
        this.check(atMs);
      }

      if (this.lastBoundaryMs !== undefined && atMs - this.lastBoundaryMs > 2500)
        this.reasons.add("gap");
      this.lastBoundaryMs = atMs;
    }
  }

  finish(recording: RecordingV2, clockSkipped: boolean): SourceAssessment {
    if (recording.initialization.source === "sim") this.reasons.add("sim");

    if (recording.initialization.clockScale !== 1) this.reasons.add("clock_scale");

    if (clockSkipped) this.reasons.add("clock_skipped");

    if (recording.observations.some((observation) => observation.gap)) this.reasons.add("gap");
    const [first, ...rest] = this.reasons;

    return {
      assurance: "client_declared",
      declaredSource: recording.initialization.source,
      window:
        first === undefined
          ? { kind: "continuous" }
          : { kind: "blocked", reasons: [first, ...rest] },
    };
  }
}

/** Declared source quality only; never hardware authentication or permission to send. */
export function recordingV2Eligibility(
  recording: RecordingV2,
  evidence: { readonly clockSkipped: boolean },
): SourceAssessment {
  const assessment = new WindowAssessment();

  for (const entry of recording.entries) assessment.ingest(entry);

  return assessment.finish(recording, evidence.clockSkipped);
}
