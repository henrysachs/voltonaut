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
  type TrainerCommand,
} from "@voltonaut/shared";
import type { RideSnapshot } from "@voltonaut/engine";

import { RecordingJournal, type JournalInitialization } from "./recordingJournal.js";
import { replaySnapshot } from "./recordingObservation.js";
import type {
  CaptureAvailability,
  CaptureCommand,
  CaptureResult,
  CaptureView,
  RideRecorder,
} from "./rideCaptureProtocol.js";
import { validCaptureReading } from "./rideCaptureProtocol.js";

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
    if (event.type === "trainer.data") {
      const power = validCaptureReading(event.powerW, 2000);
      const cadence = validCaptureReading(event.cadenceRpm, 200);
      const speed = validCaptureReading(event.speedMps, 100);

      if (
        (event.powerW !== undefined && power === null) ||
        (event.cadenceRpm !== undefined && cadence === null) ||
        (event.speedMps !== undefined && speed === null)
      ) {
        this.journal.invalidate("invalid_input");
      }

      if (event.powerW !== undefined && power === null) this.projection.invalidate("powerW");

      if (event.cadenceRpm !== undefined && cadence === null)
        this.projection.invalidate("cadenceRpm");

      this.append([0, atMs, "trainer", power, cadence, speed]);
    } else if (event.type === "hr.data") {
      if (!Number.isFinite(event.bpm) || event.bpm < 1 || event.bpm > 250) {
        this.journal.invalidate("invalid_input");
        this.projection.invalidate("hrBpm");
      } else this.append([0, atMs, "hr", event.bpm]);
    } else if (event.type === "device.status") {
      this.append([0, atMs, "status", event.kind, event.status]);
    } else if (
      event.type === "controller.button" &&
      event.pressed &&
      (event.button === "shiftUp" || event.button === "shiftDown")
    ) {
      this.append([0, atMs, "shift", event.button]);
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
      snapshot: replaySnapshot(snapshot),
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

    if (atMs - state.startMs < 1000)
      throw new Error(
        "Aufnahme leer oder ungültig. Mindestens eine Sekunde mit Trainerdaten aufnehmen.",
      );

    if (atMs - state.startMs > MAX_LOCAL_RIDE_MS)
      throw new Error(
        "Aufnahme ungültig: Maximal 6 Stunden aufnehmen. Laufende Aufnahme ausdrücklich verwerfen.",
      );
    this.boundary("sample", atMs, snapshot);
    state.lastSampleMs = atMs;
    const track = this.projection.finish();
    const recording = this.journal.finish();

    const capture = CapturedRideSchema.parse(
      recording === undefined
        ? { kind: "local_only", reason: this.journal.reason() ?? "invalid_input", track }
        : { kind: "journal", recording },
    );

    this.state = { kind: "completed", rideId: state.rideId, capture };
    this.journal.clearWindow();
  }
}

export function createRideRecorder(initialization: JournalInitialization): RideRecorder {
  return new Recorder(initialization);
}
