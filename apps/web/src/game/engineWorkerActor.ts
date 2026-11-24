import { RiderProfileSchema, type RideMode, type RiderProfile } from "@voltonaut/shared";
import { createEngine, createRoute, TEST_ROUTES, type Engine } from "@voltonaut/engine";
import { createEngineWorkerProgress, type EngineWorkerProgress } from "./engineWorkerProgress.js";
import { createRideRecorder, type RideRecorder } from "./rideRecorder.js";

export const FUN_MODE_RECORDING_REFUSAL = "Im Spaß-Modus gibt es keine Aufnahme.";

export interface Actor {
  readonly actorId: string;
  readonly engine: Engine;
  readonly recorder: RideRecorder;
  readonly progress: EngineWorkerProgress;
  readonly clockScale: number;
  /** Requested ride mode; fun mode posts no progress and refuses recordings (spec E9-01 AK8). */
  mode: RideMode;
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
    mode: "normal",
    lastWakeMs: undefined,
    lastRequestId: 0,
    intervalId: undefined,
  };
}

/**
 * Applies a mode request. A switch to fun mode while a recording is running is
 * ignored, and entering fun mode makes every later capture of this session
 * local-only: recordings must never contain item effects (spec E9-01 AK8).
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The actor is the worker-owned mutable session record.
export function setActorMode(actor: Actor, mode: RideMode, atMs: number): void {
  if (mode === "fun" && actor.recorder.view(atMs).kind !== "idle") return;

  // The session journal replays from init in normal mode; fun physics would break that replay.
  if (mode === "fun") actor.recorder.invalidate("fun_mode");

  actor.mode = mode;
  actor.engine.setMode(mode);
}
