import {
  RiderProfileSchema,
  type DeviceEvent,
  type NativeTickFacts,
  type RideEvent,
  type RideProgressCheckpoint,
  type RiderProfile,
  type TrainerCommand,
} from "@voltonaut/shared";
import { createEngine, createRoute, TEST_ROUTES, type Engine } from "@voltonaut/engine";
import {
  createEngineWorkerProgress,
  projectEngineWorkerProgress,
  type EngineWorkerProgress,
} from "./engineWorkerProgress.js";
import { createRideRecorder, type RideRecorder } from "./rideRecorder.js";
import type { CaptureCommand, CaptureResult, CaptureView } from "./rideCaptureProtocol.js";
import { isNewCaptureRequest } from "./rideCaptureProtocol.js";

export type EngineWorkerRequest =
  | {
      readonly type: "engine.init";
      readonly actorId: string;
      readonly source: "sim" | "ble";
      readonly routeId: string;
      readonly profile: RiderProfile;
      readonly clockScale: number;
    }
  | { readonly type: "engine.ingest"; readonly actorId: string; readonly event: DeviceEvent }
  | {
      readonly type: "recording.command";
      readonly actorId: string;
      readonly requestId: number;
      readonly command: CaptureCommand;
    }
  | { readonly type: "engine.dispose"; readonly actorId: string };

export type EngineWorkerResponse =
  | {
      readonly type: "engine.update";
      readonly actorId: string;
      readonly snapshot: ReturnType<Engine["snapshot"]>;
      readonly events: readonly RideEvent[];
      readonly commands: readonly TrainerCommand[];
      readonly recording: CaptureView;
      readonly progress?: RideProgressCheckpoint | undefined;
    }
  | {
      readonly type: "recording.reply";
      readonly actorId: string;
      readonly requestId: number;
      readonly result: CaptureResult;
    }
  | { readonly type: "engine.initFailed"; readonly actorId: string; readonly message: string };

export interface WorkerScopeLike {
  readonly postMessage: (message: EngineWorkerResponse) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: EngineWorkerRequest }) => void,
  ) => void;
}

export type ScheduleInterval = (handler: () => void, intervalMs: number) => number;

export type CancelInterval = (intervalId: number) => void;

export const WAKE_INTERVAL_MS = 50;

interface Actor {
  readonly actorId: string;
  readonly engine: Engine;
  readonly recorder: RideRecorder;
  readonly progress: EngineWorkerProgress;
  readonly clockScale: number;
  lastWakeMs: number | undefined;
  lastRequestId: number;
  intervalId: number | undefined;
}

function initializeActor(
  message: Extract<EngineWorkerRequest, { readonly type: "engine.init" }>,
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

class WorkerDriver {
  private actor: Actor | undefined;

  constructor(
    private readonly scope: WorkerScopeLike,
    private readonly nowMs: () => number,
    private readonly schedule: ScheduleInterval,
    private readonly cancel: CancelInterval,
    private readonly timeOriginMs: number,
    private readonly newId: () => string,
  ) {}

  private update(
    actor: Readonly<Actor>,
    atMs: number,
    startedAtMs: number | undefined,
    facts: readonly NativeTickFacts[],
  ): void {
    const snapshot = actor.engine.snapshot();
    const events = actor.engine.drainEvents();
    const commands = actor.engine.drainCommands();

    const progress = projectEngineWorkerProgress(actor.progress, {
      startedAtMs,
      endedAtMs: atMs,
      facts,
      paused: snapshot.paused,
      dataAgeS: snapshot.dataAgeS,
      clockSkipped: events.some((event) => event.type === "ride.clockSkipped"),
    });

    actor.recorder.outputs(events, commands);
    actor.recorder.sample(atMs, snapshot);
    this.post({
      type: "engine.update",
      actorId: actor.actorId,
      snapshot,
      events,
      commands,
      recording: actor.recorder.view(atMs),
      progress,
    });
  }

  private post(message: EngineWorkerResponse): void {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker messages have no targetOrigin.
    this.scope.postMessage(message);
  }

  readonly wake = (): void => {
    const actor = this.actor;

    if (actor === undefined) return;
    const atMs = this.nowMs();

    if (actor.lastWakeMs === undefined) {
      actor.lastWakeMs = atMs;
      actor.recorder.arm(atMs);

      return;
    }

    const previousWakeMs = actor.lastWakeMs;
    const elapsedRealS = (atMs - previousWakeMs) / 1000;
    actor.lastWakeMs = atMs;
    actor.recorder.advance(atMs, elapsedRealS);

    const facts = actor.engine.advance(elapsedRealS * actor.clockScale);

    this.update(actor, atMs, previousWakeMs, facts);
  };

  private init(message: Extract<EngineWorkerRequest, { readonly type: "engine.init" }>): void {
    if (this.actor !== undefined) {
      this.post({
        type: "engine.initFailed",
        actorId: message.actorId,
        message: "Engine session already initialized; dispose explicitly first.",
      });

      return;
    }

    try {
      const initializedWorkerMs = this.nowMs();
      const actor = initializeActor(message, initializedWorkerMs, this.timeOriginMs, this.newId);
      this.actor = actor;
      actor.intervalId = this.schedule(this.wake, WAKE_INTERVAL_MS);
      this.update(actor, initializedWorkerMs, undefined, []);
    } catch (cause) {
      this.post({
        type: "engine.initFailed",
        actorId: message.actorId,
        message: cause instanceof Error ? cause.message : "Engine initialization failed",
      });
    }
  }

  handle(message: EngineWorkerRequest): void {
    if (message.type === "engine.init") {
      this.init(message);
    } else {
      this.handleActive(message);
    }
  }

  private handleActive(
    message: Exclude<EngineWorkerRequest, { readonly type: "engine.init" }>,
  ): void {
    const actor = this.actor;

    if (actor === undefined || message.actorId !== actor.actorId) return;

    if (message.type === "engine.ingest") {
      if (actor.intervalId === undefined) return;
      actor.recorder.ingest(message.event, this.nowMs());
      actor.engine.ingest(message.event);

      return;
    }

    if (message.type === "recording.command") {
      const atMs = this.nowMs();

      const result: CaptureResult =
        isNewCaptureRequest(message.requestId, actor.lastRequestId) &&
        (actor.intervalId !== undefined || message.command.kind !== "start")
          ? actor.recorder.command(message.command, atMs, actor.engine.snapshot())
          : {
              kind: "failed",
              message: "Veralteter oder doppelter Aufnahmebefehl.",
              view: actor.recorder.view(atMs),
            };

      if (Number.isSafeInteger(message.requestId))
        actor.lastRequestId = Math.max(actor.lastRequestId, message.requestId);
      this.post({
        type: "recording.reply",
        actorId: actor.actorId,
        requestId: message.requestId,
        result,
      });

      if (actor.intervalId === undefined && actor.recorder.view(atMs).kind === "idle")
        this.actor = undefined;

      return;
    }

    this.dispose();
  }

  private dispose(): void {
    const actor = this.actor;

    if (actor === undefined) return;

    if (actor.intervalId !== undefined) this.cancel(actor.intervalId);
    actor.intervalId = undefined;

    if (actor.recorder.view(this.nowMs()).kind === "idle") this.actor = undefined;
  }
}

export function bindEngineWorker(
  scope: WorkerScopeLike,
  nowMs: () => number,
  schedule: ScheduleInterval,
  cancel: CancelInterval,
  timeOriginMs = 0,
  newId: () => string = () => crypto.randomUUID(),
): void {
  const driver = new WorkerDriver(scope, nowMs, schedule, cancel, timeOriginMs, newId);
  scope.addEventListener("message", (event) => {
    driver.handle(event.data);
  });
}
