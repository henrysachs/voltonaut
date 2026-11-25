import type {
  DeviceEvent,
  RideEvent,
  RideMode,
  RideProgressCheckpoint,
  TrainerCommand,
} from "@voltonaut/shared";
import type { Engine } from "@voltonaut/engine";
import {
  startRecordedRide,
  type RecordedRide,
  type RideInit,
  type RideUpdate,
} from "./recordedRide.js";
import type { CaptureCommand, CaptureResult, CaptureView } from "./rideCaptureProtocol.js";

export type EngineWorkerRequest =
  | ({ readonly type: "engine.init"; readonly actorId: string } & RideInit)
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

interface Actor {
  readonly actorId: string;
  readonly ride: RecordedRide;
  readonly intervalId: number | undefined;
}

/** Message dispatch and wake scheduling; the recorded ride owns everything else. */
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

  private post(message: EngineWorkerResponse): void {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker messages have no targetOrigin.
    this.scope.postMessage(message);
  }

  private postUpdate(actorId: string, update: RideUpdate): void {
    this.post({ type: "engine.update", actorId, ...update });
  }

  private readonly wake = (): void => {
    const actor = this.actor;

    if (actor === undefined) return;
    const update = actor.ride.wake(this.nowMs());

    if (update !== undefined) this.postUpdate(actor.actorId, update);
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
      const { ride, update } = startRecordedRide(
        message,
        this.nowMs(),
        this.timeOriginMs,
        this.newId,
      );

      const intervalId = this.schedule(this.wake, WAKE_INTERVAL_MS);
      this.actor = { actorId: message.actorId, ride, intervalId };
      this.postUpdate(message.actorId, update);
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

      return;
    }

    const actor = this.actor;

    if (actor === undefined || message.actorId !== actor.actorId) return;

    switch (message.type) {
      case "engine.ingest":
        actor.ride.ingest(message.event, this.nowMs());
        break;
      case "engine.setMode":
        actor.ride.setMode(message.mode, this.nowMs());
        break;
      case "recording.command":
        this.capture(actor, message);
        break;
      case "engine.dispose":
        this.dispose(actor);
        break;
      default: {
        const exhaustive: never = message;

        return exhaustive;
      }
    }
  }

  private capture(
    actor: Actor,
    message: Extract<EngineWorkerRequest, { readonly type: "recording.command" }>,
  ): void {
    const atMs = this.nowMs();
    const result = actor.ride.capture(message.requestId, message.command, atMs);

    this.post({
      type: "recording.reply",
      actorId: actor.actorId,
      requestId: message.requestId,
      result,
    });
    this.release(actor, atMs);
  }

  private dispose(actor: Actor): void {
    if (actor.intervalId !== undefined) this.cancel(actor.intervalId);
    actor.ride.stop();
    this.actor = { ...actor, intervalId: undefined };
    this.release(actor, this.nowMs());
  }

  /** A stopped ride stays until its unsecured completion is released (ADR-018). */
  private release(actor: Actor, atMs: number): void {
    if (actor.ride.closed(atMs)) this.actor = undefined;
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
