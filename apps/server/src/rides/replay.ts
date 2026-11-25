import {
  applyJournalEntry,
  createEngine,
  createRoute,
  PHYSICS_REVISION,
  replaySnapshotEqual,
  TEST_LOOP,
  type Engine,
  type RideSnapshot,
} from "@voltonaut/engine";
import {
  RecordingV2Schema,
  type RecordingEntryV2,
  type RecordingV2,
  type ReplayObservationV2,
  type RideAssessment,
  type ReplayWindowSummary,
} from "@voltonaut/shared";

import { replayCommandEqual, replayEventEqual } from "./replayComparison.js";
import { recordingV2Eligibility } from "./replayEligibility.js";

export type RecordingV2Assessment =
  | RideAssessment
  | { readonly status: "rejected"; readonly reason: "invalid_contract" };

function windowSummary(
  start: RideSnapshot,
  finish: RideSnapshot,
  counts: {
    readonly elapsedRealS: number;
    readonly eventCount: number;
    readonly commandCount: number;
  },
): ReplayWindowSummary {
  return {
    ...counts,
    distanceM: finish.distanceM - start.distanceM,
    elevationGainM: finish.elevationGainM - start.elevationGainM,
    energyKj: finish.energyKj - start.energyKj,
    tS: finish.tS - start.tS,
    laps: finish.lap - start.lap,
  };
}

class ReplayRun {
  private readonly recording: RecordingV2;
  private readonly engine: Engine;
  private observationIndex = 0;
  private eventOffset = 0;
  private commandOffset = 0;
  private eventCount = 0;
  private commandCount = 0;
  private start: { readonly snapshot: RideSnapshot; readonly workerMs: number } | undefined;
  private clockSkipped = false;

  constructor(recording: RecordingV2) {
    this.recording = recording;
    this.engine = createEngine({
      route: createRoute(TEST_LOOP),
      profile: recording.initialization.profile,
    });
  }

  private drain(observation: ReplayObservationV2): boolean {
    for (const event of this.engine.drainEvents()) {
      if (!replayEventEqual(event, observation.events[this.eventOffset])) return false;
      this.eventOffset += 1;

      if (this.start !== undefined) this.eventCount += 1;
      this.clockSkipped ||= this.start !== undefined && event.type === "ride.clockSkipped";
    }

    for (const command of this.engine.drainCommands()) {
      if (!replayCommandEqual(command, observation.commands[this.commandOffset])) return false;
      this.commandOffset += 1;

      if (this.start !== undefined) this.commandCount += 1;
    }

    return true;
  }

  private boundary(
    entry: RecordingEntryV2,
    observation: ReplayObservationV2,
  ): RecordingV2Assessment | undefined {
    const snapshot = this.engine.snapshot();

    if (
      this.eventOffset !== observation.events.length ||
      this.commandOffset !== observation.commands.length ||
      !replaySnapshotEqual(snapshot, observation.snapshot)
    )
      return { status: "rejected", reason: "observation_mismatch" };
    this.observationIndex += 1;
    this.eventOffset = 0;
    this.commandOffset = 0;

    if (entry[3] === "start") this.start = { snapshot, workerMs: entry[1] };

    if (entry[3] !== "finish" || this.start === undefined) return undefined;

    return {
      status: "replayed",
      physicsRevision: PHYSICS_REVISION,
      summary: windowSummary(this.start.snapshot, snapshot, {
        elapsedRealS: (entry[1] - this.start.workerMs) / 1000,
        eventCount: this.eventCount,
        commandCount: this.commandCount,
      }),
      source: recordingV2Eligibility(this.recording, {
        clockSkipped: this.clockSkipped,
      }),
    };
  }

  run(): RecordingV2Assessment {
    for (const entry of this.recording.entries) {
      const observation = this.recording.observations[this.observationIndex];

      if (observation === undefined) return { status: "rejected", reason: "invalid_contract" };
      applyJournalEntry(this.engine, entry, this.recording.initialization.clockScale);

      if (!this.drain(observation)) return { status: "rejected", reason: "observation_mismatch" };

      if (entry[2] === "boundary") {
        const result = this.boundary(entry, observation);

        if (result !== undefined) return result;
      }
    }

    return { status: "rejected", reason: "invalid_contract" };
  }
}

/** Pure consistency assessment only. No account lookup, persistence, rewards or provider calls. */
export function assessRecordingV2(recording: RecordingV2): RecordingV2Assessment {
  const parsed = RecordingV2Schema.safeParse(recording);

  if (!parsed.success) return { status: "rejected", reason: "invalid_contract" };
  const normalized = parsed.data;

  if (normalized.journalState !== "complete")
    return { status: "unverified", reason: "incomplete_journal" };
  const initialization = normalized.initialization;

  if (
    initialization.physicsRevision !== PHYSICS_REVISION ||
    initialization.routeId !== "test-loop" ||
    initialization.routeRevision !== "1"
  ) {
    return { status: "unverified", reason: "unknown_revision" };
  }

  return new ReplayRun(normalized).run();
}
