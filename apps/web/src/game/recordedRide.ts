import {
  describeRideReference,
  RIDE_MODES,
  rideReferenceOf,
  RiderProfileSchema,
  type DeviceEvent,
  type NativeTickFacts,
  type RideEvent,
  type RideMode,
  type RideProgressCheckpoint,
  type RiderProfile,
  type TrainerCommand,
  type WorldPathReference,
} from "@voltonaut/shared";
import {
  createEngine,
  createRoute,
  PHYSICS_REVISION,
  WORLDS,
  worldPathRoute,
  type Engine,
  type RideSnapshot,
} from "@voltonaut/engine";
import {
  createEngineWorkerProgress,
  projectEngineWorkerProgress,
  type EngineWorkerProgress,
} from "./engineWorkerProgress.js";
import type {
  CaptureCommand,
  CaptureResult,
  CaptureView,
  RideRecorder,
} from "./rideCaptureProtocol.js";
import { isNewCaptureRequest } from "./rideCaptureProtocol.js";
import { createRideRecorder } from "./rideRecorder.js";

const STALE_CAPTURE_REFUSAL = "Veralteter oder doppelter Aufnahmebefehl.";
const UNRECORDABLE_MODE_REFUSAL = "In diesem Spielmodus gibt es keine Aufnahme.";

export interface RideInit {
  readonly source: "sim" | "ble";
  /** The driven world path; the tick gets its route and recordings name it (ADR-033 §3, §7). */
  readonly worldPath: WorldPathReference;
  readonly profile: RiderProfile;
  readonly clockScale: number;
}

/** Engine outputs of one step, drained once and already delivered to the journal. */
export interface RideUpdate {
  readonly snapshot: RideSnapshot;
  readonly events: readonly RideEvent[];
  readonly commands: readonly TrainerCommand[];
  readonly recording: CaptureView;
  readonly progress: RideProgressCheckpoint | undefined;
}

/**
 * One engine session with its journal recorder and progress projection (ADR-011,
 * ADR-018, ADR-028). Every input carries the worker clock reading. Callers only
 * dispatch inputs; the actor order between engine, journal and progress lives here.
 */
export interface RecordedRide {
  /** Journals the raw reading, then buffers it in the engine. Ignored once stopped. */
  readonly ingest: (event: DeviceEvent, atMs: number) => void;
  /** The first wake only arms the clock; later wakes advance and return the update. */
  readonly wake: (atMs: number) => RideUpdate | undefined;
  /** A mode without journal replay is ignored while a capture is held (ADR-028). */
  readonly setMode: (mode: RideMode, atMs: number) => void;
  /** Reads the committed engine state; never advances or arms the clock. */
  readonly capture: (requestId: number, command: CaptureCommand, atMs: number) => CaptureResult;
  /** Ends wakes and inputs. An unsecured completion stays until its release. */
  readonly stop: () => void;
  /** Stopped, with no capture left to hand over. */
  readonly closed: (atMs: number) => boolean;
}

export interface StartedRide {
  readonly ride: RecordedRide;
  readonly update: RideUpdate;
}

type RideClock =
  | { readonly kind: "unarmed" }
  | { readonly kind: "armed"; readonly lastWakeMs: number }
  | { readonly kind: "stopped" };

class Ride implements RecordedRide {
  private clock: RideClock = { kind: "unarmed" };
  private lastRequestId = 0;

  constructor(
    private readonly engine: Engine,
    private readonly recorder: RideRecorder,
    private readonly progress: EngineWorkerProgress,
    private readonly clockScale: number,
    private readonly timeOriginMs: number,
  ) {}

  ingest(event: DeviceEvent, atMs: number): void {
    if (this.clock.kind === "stopped") return;
    this.recorder.ingest(event, atMs);
    this.engine.ingest(event);
  }

  wake(atMs: number): RideUpdate | undefined {
    const clock = this.clock;

    if (clock.kind === "stopped") return undefined;

    if (clock.kind === "unarmed") {
      this.clock = { kind: "armed", lastWakeMs: atMs };
      this.recorder.arm(atMs);

      return undefined;
    }

    const elapsedRealS = (atMs - clock.lastWakeMs) / 1000;
    this.clock = { kind: "armed", lastWakeMs: atMs };
    this.recorder.advance(atMs, elapsedRealS);

    const facts = this.engine.advance(elapsedRealS * this.clockScale);

    return this.update(atMs, clock.lastWakeMs, facts);
  }

  setMode(mode: RideMode, atMs: number): void {
    if (!RIDE_MODES[mode].recordable) {
      if (this.recorder.view(atMs).kind !== "idle") return;

      // The journal replays from init and knows no mode, so later captures stay local.
      this.recorder.invalidate("ride_mode");
    }

    this.engine.setMode(mode);
  }

  capture(requestId: number, command: CaptureCommand, atMs: number): CaptureResult {
    const result = this.captureResult(requestId, command, atMs);

    if (Number.isSafeInteger(requestId))
      this.lastRequestId = Math.max(this.lastRequestId, requestId);

    return result;
  }

  stop(): void {
    this.clock = { kind: "stopped" };
  }

  closed(atMs: number): boolean {
    return this.clock.kind === "stopped" && this.recorder.view(atMs).kind === "idle";
  }

  /** Posts the committed init state; no wake has run, so there is no progress yet. */
  initial(atMs: number): RideUpdate {
    return this.update(atMs, undefined, []);
  }

  private update(
    atMs: number,
    startedAtMs: number | undefined,
    facts: readonly NativeTickFacts[],
  ): RideUpdate {
    const snapshot = this.engine.snapshot();
    const events = this.engine.drainEvents();
    const commands = this.engine.drainCommands();

    // Modes without progress post no checkpoints (ADR-028).
    const progress = RIDE_MODES[snapshot.mode.kind].progress
      ? projectEngineWorkerProgress(this.progress, {
          startedAtMs:
            startedAtMs === undefined ? undefined : Math.round(this.timeOriginMs + startedAtMs),
          endedAtMs: Math.round(this.timeOriginMs + atMs),
          facts,
          paused: snapshot.paused,
          dataAgeS: snapshot.dataAgeS,
          clockSkipped: events.some((event) => event.type === "ride.clockSkipped"),
        })
      : undefined;

    this.recorder.outputs(events, commands);
    this.recorder.sample(atMs, snapshot);

    return { snapshot, events, commands, recording: this.recorder.view(atMs), progress };
  }

  private captureResult(requestId: number, command: CaptureCommand, atMs: number): CaptureResult {
    const refusal = (message: string): CaptureResult => ({
      kind: "failed",
      message,
      view: this.recorder.view(atMs),
    });

    if (
      !isNewCaptureRequest(requestId, this.lastRequestId) ||
      (command.kind === "start" && this.clock.kind === "stopped")
    )
      return refusal(STALE_CAPTURE_REFUSAL);

    // The engine owns the mode; a start follows the mode it was last asked for (ADR-028).
    if (command.kind === "start" && !RIDE_MODES[this.engine.requestedMode()].recordable)
      return refusal(UNRECORDABLE_MODE_REFUSAL);

    return this.recorder.command(command, atMs, this.engine.snapshot());
  }
}

/** Validates the init request and returns the ride with its first, unadvanced update. */
export function startRecordedRide(
  init: RideInit,
  atMs: number,
  timeOriginMs: number,
  newId: () => string,
): StartedRide {
  const routeData = worldPathRoute(WORLDS, init.worldPath);

  if (routeData === undefined)
    throw new Error(`unknown world path: ${describeRideReference(init.worldPath)}`);

  if (!Number.isFinite(init.clockScale) || init.clockScale < 1 || init.clockScale > 20)
    throw new Error("Invalid engine clock scale");
  const profile = RiderProfileSchema.parse(init.profile);
  const engine = createEngine({ route: createRoute(routeData), profile });

  const progress = createEngineWorkerProgress({
    source: init.source,
    clockScale: init.clockScale,
    worldPath: init.worldPath,
    profile,
    newId,
  });

  const recorder = createRideRecorder({
    initializedAt: new Date(timeOriginMs + atMs).toISOString(),
    initialization: {
      physicsRevision: PHYSICS_REVISION,
      ...rideReferenceOf(init.worldPath),
      profile,
      source: init.source,
      clockScale: init.clockScale,
      workerTimeOriginMs: timeOriginMs,
      initializedWorkerMs: atMs,
    },
  });

  const ride = new Ride(engine, recorder, progress, init.clockScale, timeOriginMs);

  return { ride, update: ride.initial(atMs) };
}
