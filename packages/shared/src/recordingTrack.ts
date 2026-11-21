import {
  LocalRidePointSchema,
  RideTrackSchema,
  type LocalRidePoint,
  type RideTrack,
} from "./localRide.js";
import type { RecordingEntryV2, RecordingV2, ReplayObservationV2 } from "./recordingV2.js";

interface Reading {
  readonly value: number;
  readonly atMs: number;
}

type ProjectionWindow =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "active";
      readonly startMs: number;
      readonly baselineM: number;
      readonly samples: LocalRidePoint[];
      lastBoundaryMs: number;
    };

const FRESH_MS = 2500;

function fresh(reading: Reading | undefined, atMs: number): number | undefined {
  return reading !== undefined && atMs >= reading.atMs && atMs - reading.atMs <= FRESH_MS
    ? reading.value
    : undefined;
}

class TrackProjection {
  private power: Reading | undefined;
  private cadence: Reading | undefined;
  private heartRate: Reading | undefined;
  private trainer: "ready" | "not_ready" = "not_ready";
  private continuity: "continuous" | "gap" = "continuous";
  private window: ProjectionWindow = { kind: "waiting" };

  constructor(private readonly recording: RecordingV2) {}

  private missingTrainer(atMs: number): boolean {
    return (
      this.trainer !== "ready" ||
      fresh(this.power, atMs) === undefined ||
      fresh(this.cadence, atMs) === undefined
    );
  }

  ingest(entry: RecordingEntryV2): void {
    const atMs = entry[1];

    if (this.window.kind === "active" && this.missingTrainer(atMs)) {
      this.continuity = "gap";
    }

    if (entry[2] === "trainer") {
      if (entry[3] !== null) this.power = { value: entry[3], atMs };

      if (entry[4] !== null) this.cadence = { value: entry[4], atMs };
    } else if (entry[2] === "hr") {
      this.heartRate = { value: entry[3], atMs };
    } else if (entry[2] === "status") {
      if (entry[3] === "trainer") {
        this.trainer = entry[4] === "ready" ? "ready" : "not_ready";

        if (this.trainer === "not_ready") {
          this.power = undefined;
          this.cadence = undefined;

          if (this.window.kind === "active") this.continuity = "gap";
        }
      } else if (entry[3] === "heartRate" && entry[4] !== "ready") {
        this.heartRate = undefined;
      }
    }
  }

  boundary(entry: RecordingEntryV2, observation: ReplayObservationV2): void {
    const atMs = entry[1];

    if (entry[0] === this.recording.window.startSeq) {
      this.window = {
        kind: "active",
        startMs: atMs,
        baselineM: observation.snapshot.distanceM,
        samples: [],
        lastBoundaryMs: atMs,
      };
      this.continuity = "continuous";
    }

    const state = this.window;

    if (state.kind !== "active") return;
    const powerW = fresh(this.power, atMs);
    const cadenceRpm = fresh(this.cadence, atMs);
    const hrBpm = fresh(this.heartRate, atMs);

    const point = LocalRidePointSchema.parse({
      elapsedMs: Math.round(atMs - state.startMs),
      distanceM: observation.snapshot.distanceM - state.baselineM,
      powerW,
      cadenceRpm,
      hrBpm,
      gap:
        observation.gap ||
        this.continuity === "gap" ||
        atMs - state.lastBoundaryMs > FRESH_MS ||
        this.missingTrainer(atMs),
    });

    const previous = state.samples.at(-1);

    if (previous !== undefined && previous.elapsedMs === point.elapsedMs) {
      state.samples[state.samples.length - 1] = {
        ...point,
        distanceM: point.elapsedMs === 0 ? 0 : point.distanceM,
        gap: previous.gap || point.gap,
      };
    } else {
      state.samples.push(point);
    }

    state.lastBoundaryMs = atMs;
    this.continuity = "continuous";
  }

  finish(): RideTrack {
    const state = this.window;

    if (state.kind !== "active") throw new Error("Aufnahmefenster fehlt.");
    const initialization = this.recording.initialization;

    return RideTrackSchema.parse({
      rideId: this.recording.rideId,
      startedAt: new Date(
        Date.parse(this.recording.initializedAt) +
          state.startMs -
          initialization.initializedWorkerMs,
      ).toISOString(),
      metadata: {
        source: initialization.source,
        routeId: initialization.routeId,
        routeRevision: initialization.routeRevision,
        physicsClockScale: initialization.clockScale,
        profile: initialization.profile,
      },
      samples: state.samples,
    });
  }
}

export function projectRecordingTrack(recording: RecordingV2): RideTrack {
  const projection = new TrackProjection(recording);
  const observations = recording.observations.values();

  for (const entry of recording.entries) {
    projection.ingest(entry);

    if (entry[2] === "boundary") {
      const observation = observations.next();

      if (observation.done === true) throw new Error("Aufnahmebeobachtung fehlt.");
      projection.boundary(entry, observation.value);
    }
  }

  return projection.finish();
}
