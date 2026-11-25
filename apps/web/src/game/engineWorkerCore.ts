import {
  RIDE_MODES,
  type DeviceEvent,
  type NativeTickFacts,
  type RideEvent,
  type RideMode,
  type RideProgressCheckpoint,
  type TrainerCommand,
} from "@voltonaut/shared";
import type { Engine } from "@voltonaut/engine";
import {
  initializeActor,
  requestedModeTraits,
  setActorMode,
  UNRECORDABLE_MODE_REFUSAL,
  type Actor,
  type ActorInit,
} from "./engineWorkerActor.js";
import { projectEngineWorkerProgress } from "./engineWorkerProgress.js";
import type { CaptureCommand, CaptureResult, CaptureView } from "./rideCaptureProtocol.js";
import { isNewCaptureRequest } from "./rideCaptureProtocol.js";

export type EngineWorkerRequest =
  | ({ readonly type: "engine.init" } & ActorInit)
  | { readonly type: "engine.setMode"; readonly actorId: string; readonly mode: RideMode }
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

    // Modes without progress post no checkpoints (ADR-028).
    const progress = RIDE_MODES[snapshot.mode.kind].progress
      ? projectEngineWorkerProgress(actor.progress, {
          startedAtMs,
          endedAtMs: atMs,
          facts,
          paused: snapshot.paused,
          dataAgeS: snapshot.dataAgeS,
          clockSkipped: events.some((event) => event.type === "ride.clockSkipped"),
        })
      : undefined;

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

    if (message.type === "engine.setMode") {
      setActorMode(actor, message.mode, this.nowMs());

      return;
    }

    if (message.type === "recording.command") {
      const atMs = this.nowMs();

      const result: CaptureResult = this.captureResult(actor, message, atMs);

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

  private captureResult(
    actor: Readonly<Actor>,
    message: Extract<EngineWorkerRequest, { readonly type: "recording.command" }>,
    atMs: number,
  ): CaptureResult {
    const refusal = (text: string): CaptureResult => ({
      kind: "failed",
      message: text,
      view: actor.recorder.view(atMs),
    });

    if (
      !isNewCaptureRequest(message.requestId, actor.lastRequestId) ||
      (message.command.kind === "start" && actor.intervalId === undefined)
    )
      return refusal("Veralteter oder doppelter Aufnahmebefehl.");

    if (message.command.kind === "start" && !requestedModeTraits(actor).recordable)
      return refusal(UNRECORDABLE_MODE_REFUSAL);

    return actor.recorder.command(message.command, atMs, actor.engine.snapshot());
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
