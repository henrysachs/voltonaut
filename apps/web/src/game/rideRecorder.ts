import {
  CapturedRideSchema,
  MAX_LOCAL_RIDE_MS,
  RecordingEntryV2Schema,
  RideTrackSchema,
  ReplayEventV2Schema,
  ReplayCommandV2Schema,
  createRecordingTrackProjection,
  type CapturedRide,
  type CaptureUnavailabilityReason,
  type DeviceEvent,
  type RecordingEntryV2,
  type ReplayObservationV2,
  type RideEvent,
  type RideTrack,
  type TrainerCommand,
} from "@voltonaut/shared";
import {
  encodeJournalInput,
  projectReplaySnapshot,
  type RejectedReading,
  type RideSnapshot,
} from "@voltonaut/engine";

import { RecordingJournal, type JournalInitialization } from "./recordingJournal.js";
import type {
  CaptureAvailability,
  CaptureCommand,
  CaptureResult,
  CaptureView,
  RideRecorder,
} from "./rideCaptureProtocol.js";

const EMPTY_CAPTURE_MESSAGE =
  "Aufnahme leer oder ungültig. Mindestens eine Sekunde mit Trainerdaten aufnehmen.";

type RecorderState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "recording";
      readonly rideId: string;
      readonly startMs: number;
      lastSampleMs: number;
    }
  | { readonly kind: "completed"; readonly rideId: string; readonly capture: CapturedRide };

class Recorder implements RideRecorder {
  private readonly journal: RecordingJournal;
  private readonly projection;
  private state: RecorderState = { kind: "idle" };
  private gap = false;

  constructor(initialization: JournalInitialization) {
    this.journal = new RecordingJournal(initialization);
    this.projection = createRecordingTrackProjection(initialization);
  }

  private availability(): CaptureAvailability {
    const reason = this.journal.reason();

    return reason === undefined ? { kind: "journal" } : { kind: "local_only", reason };
  }

  view(atMs: number): CaptureView {
    const state = this.state;

    switch (state.kind) {
      case "idle":
        return { kind: "idle", availability: this.availability() };
      case "completed":
        return {
          kind: "completed",
          rideId: state.rideId,
          availability:
            state.capture.kind === "journal"
              ? { kind: "journal" }
              : { kind: "local_only", reason: state.capture.reason },
        };
      case "recording":
        return {
          kind: "recording",
          rideId: state.rideId,
          elapsedMs: Math.max(0, Math.round(atMs - state.startMs)),
          availability: this.availability(),
        };
      default: {
        const exhaustive: never = state;

        return exhaustive;
      }
    }
  }

  private append(entry: RecordingEntryV2): void {
    const parsed = RecordingEntryV2Schema.safeParse(entry);

    if (!parsed.success) {
      this.journal.invalidate("invalid_input");

      return;
    }

    this.journal.append(parsed.data);
    this.projection.ingest(parsed.data);
  }

  ingest(event: DeviceEvent, atMs: number): void {
    const decision = encodeJournalInput(event, atMs);

    if (decision.kind === "ignored") return;
    this.reject(decision.rejected);

    if (decision.kind === "entry") this.append(decision.entry);
  }

  private reject(readings: readonly RejectedReading[]): void {
    if (readings.length > 0) this.journal.invalidate("invalid_input");

    for (const reading of readings) {
      // Speed is not a track channel; its rejection only invalidates the journal.
      if (reading !== "speedMps") this.projection.invalidate(reading);
    }
  }

  arm(atMs: number): void {
    this.append([0, atMs, "arm"]);
  }
  advance(atMs: number, elapsedRealS: number): void {
    this.journal.observeTime(atMs);
    this.append([0, atMs, "advance", elapsedRealS]);
  }

  outputs(events: readonly RideEvent[], commands: readonly TrainerCommand[]): void {
    for (const event of events) {
      const parsed = ReplayEventV2Schema.safeParse(event);

      if (parsed.success) this.journal.outputs([parsed.data], []);
      else this.journal.invalidate("invalid_input");
    }

    for (const command of commands) {
      const parsed = ReplayCommandV2Schema.safeParse(command);

      if (parsed.success) this.journal.outputs([], [parsed.data]);
      else this.journal.invalidate("invalid_input");
    }

    this.gap ||= events.some((event) => event.type === "ride.clockSkipped");
  }

  private boundary(
    kind: "start" | "sample" | "finish",
    atMs: number,
    snapshot: RideSnapshot,
  ): void {
    const observation: ReplayObservationV2 = {
      boundarySeq: 0,
      snapshot: projectReplaySnapshot(snapshot),
      events: [],
      commands: [],
      gap: this.gap,
    };

    this.journal.boundary(atMs, kind, observation.snapshot, this.gap);
    this.projection.boundary([0, atMs, "boundary", kind], observation);
    this.gap = false;
  }

  invalidate(reason: CaptureUnavailabilityReason): void {
    this.journal.invalidate(reason);
  }

  sample(atMs: number, snapshot: RideSnapshot): void {
    const state = this.state;

    if (
      state.kind !== "recording" ||
      atMs - state.lastSampleMs < 1000 ||
      atMs - state.startMs > MAX_LOCAL_RIDE_MS
    )
      return;

    try {
      this.boundary("sample", atMs, snapshot);
      state.lastSampleMs = atMs;
    } catch {
      this.journal.invalidate("invalid_input");
    }
  }

  command(command: CaptureCommand, atMs: number, snapshot: RideSnapshot): CaptureResult {
    try {
      this.apply(command, atMs, snapshot);
      const state = this.state;

      return command.kind === "finish" && state.kind === "completed"
        ? { kind: "finished", capture: state.capture, view: this.view(atMs) }
        : { kind: "state", view: this.view(atMs) };
    } catch (cause) {
      return {
        kind: "failed",
        message: cause instanceof Error ? cause.message : "Aufnahme fehlgeschlagen.",
        view: this.view(atMs),
      };
    }
  }

  private apply(command: CaptureCommand, atMs: number, snapshot: RideSnapshot): void {
    const state = this.state;

    if (command.kind === "start") {
      if (state.kind !== "idle")
        throw new Error("Aufnahme läuft bereits oder Abschluss noch ungesichert.");
      RideTrackSchema.unwrap().innerType().shape.rideId.parse(command.rideId);
      this.projection.start(command.rideId);
      this.journal.start(command.rideId);
      this.gap = false;
      this.boundary("start", atMs, snapshot);
      this.state = { kind: "recording", rideId: command.rideId, startMs: atMs, lastSampleMs: atMs };

      return;
    }

    if (state.kind === "idle" || state.rideId !== command.rideId)
      throw new Error("Veraltete Aufnahme-ID.");

    if (command.kind === "release") {
      if (state.kind !== "completed") throw new Error("Kein freizugebender Abschluss.");
      this.state = { kind: "idle" };
      this.journal.clearWindow();

      return;
    }

    if (state.kind !== "recording") throw new Error("Keine laufende Aufnahme.");

    if (command.kind === "discard") {
      this.state = { kind: "idle" };
      this.journal.clearWindow();

      return;
    }

    this.finish(atMs, snapshot);
  }

  private finish(atMs: number, snapshot: RideSnapshot): void {
    const state = this.state;

    if (state.kind !== "recording") throw new Error("Keine laufende Aufnahme.");

    if (atMs - state.startMs < 1000) throw new Error(EMPTY_CAPTURE_MESSAGE);

    if (atMs - state.startMs > MAX_LOCAL_RIDE_MS)
      throw new Error(
        "Aufnahme ungültig: Maximal 6 Stunden aufnehmen. Laufende Aufnahme ausdrücklich verwerfen.",
      );
    this.boundary("sample", atMs, snapshot);
    state.lastSampleMs = atMs;
    const track = this.track();
    const recording = this.journal.finish();

    const capture = CapturedRideSchema.parse(
      recording === undefined
        ? { kind: "local_only", reason: this.journal.reason() ?? "invalid_input", track }
        : { kind: "journal", recording },
    );

    this.state = { kind: "completed", rideId: state.rideId, capture };
    this.journal.clearWindow();
  }

  /** A window without any trainer reading is empty, however long it ran. */
  private track(): RideTrack {
    try {
      return this.projection.finish();
    } catch {
      throw new Error(EMPTY_CAPTURE_MESSAGE);
    }
  }
}

export function createRideRecorder(initialization: JournalInitialization): RideRecorder {
  return new Recorder(initialization);
}
