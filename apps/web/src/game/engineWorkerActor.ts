import {
  RIDE_MODES,
  RiderProfileSchema,
  type RideMode,
  type RideModeTraits,
  type RiderProfile,
} from "@voltonaut/shared";
import { createEngine, createRoute, TEST_ROUTES, type Engine } from "@voltonaut/engine";
import { createEngineWorkerProgress, type EngineWorkerProgress } from "./engineWorkerProgress.js";
import type { RideRecorder } from "./rideCaptureProtocol.js";
import { createRideRecorder } from "./rideRecorder.js";

export const UNRECORDABLE_MODE_REFUSAL = "In diesem Spielmodus gibt es keine Aufnahme.";

export interface Actor {
  readonly actorId: string;
  readonly engine: Engine;
  readonly recorder: RideRecorder;
  readonly progress: EngineWorkerProgress;
  readonly clockScale: number;
  lastWakeMs: number | undefined;
  lastRequestId: number;
  intervalId: number | undefined;
}

export interface ActorInit {
  readonly actorId: string;
  readonly source: "sim" | "ble";
  readonly routeId: string;
  readonly profile: RiderProfile;
  readonly clockScale: number;
}

export function initializeActor(
  message: ActorInit,
  initializedWorkerMs: number,
  timeOriginMs: number,
  newId: () => string,
): Actor {
  const routeData = TEST_ROUTES[message.routeId];

  if (routeData === undefined) throw new Error(`unknown route ${message.routeId}`);

  if (!Number.isFinite(message.clockScale) || message.clockScale < 1 || message.clockScale > 20)
    throw new Error("Invalid engine clock scale");
  const profile = RiderProfileSchema.parse(message.profile);
  const engine = createEngine({ route: createRoute(routeData), profile });

  const progress = createEngineWorkerProgress({ ...message, profile, newId });

  const recorder = createRideRecorder({
    initializedAt: new Date(timeOriginMs + initializedWorkerMs).toISOString(),
    initialization: {
      physicsRevision: "engine-v1",
      routeId: message.routeId,
      routeRevision: "1",
      profile,
      source: message.source,
      clockScale: message.clockScale,
      workerTimeOriginMs: timeOriginMs,
      initializedWorkerMs,
    },
  });

  return {
    actorId: message.actorId,
    engine,
    recorder,
    progress,
    clockScale: message.clockScale,
    lastWakeMs: undefined,
    lastRequestId: 0,
    intervalId: undefined,
  };
}

/** Traits of the mode the engine was last asked for; the engine owns the mode (ADR-028). */
export function requestedModeTraits(actor: Readonly<Pick<Actor, "engine">>): RideModeTraits {
  return RIDE_MODES[actor.engine.requestedMode()];
}

/**
 * Applies a mode request. A switch to a mode without journal replay is ignored
 * while a recording runs, and entering one makes every later capture of this
 * session local-only: the journal replays from init and knows no mode (ADR-028).
 */
export function setActorMode(actor: Readonly<Actor>, mode: RideMode, atMs: number): void {
  if (!RIDE_MODES[mode].recordable) {
    if (actor.recorder.view(atMs).kind !== "idle") return;

    actor.recorder.invalidate("ride_mode");
  }

  actor.engine.setMode(mode);
}
