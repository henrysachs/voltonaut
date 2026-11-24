import type {
  DeviceEvent,
  RideEvent,
  RideProgressCheckpoint,
  RiderProfile,
  TrainerCommand,
} from "@voltonaut/shared";
import type { RideSnapshot } from "@voltonaut/engine";

import type { EngineWorkerRequest, EngineWorkerResponse } from "./engineWorkerCore.js";
import type {
  CaptureCommand,
  CaptureResult,
  CaptureView,
  RecordingControls,
} from "./rideCaptureProtocol.js";

export interface EngineWorkerPort {
  readonly postMessage: (message: EngineWorkerRequest) => void;
  readonly subscribe: (listener: (message: EngineWorkerResponse) => void) => () => void;
  readonly subscribeFailure: (listener: (message: string) => void) => () => void;
}

export interface EngineLinkCallbacks {
  readonly onSnapshot?: (snapshot: RideSnapshot) => void;
  readonly onEvents?: (events: readonly RideEvent[]) => void;
  readonly onCommands?: (commands: readonly TrainerCommand[]) => void;
  readonly onProgress?: (checkpoint: RideProgressCheckpoint | undefined) => void;
  readonly onInitFailed?: (message: string) => void;
}

export interface EngineLinkInit {
  readonly source: "sim" | "ble";
  readonly routeId: string;
  readonly profile: RiderProfile;
  readonly clockScale?: number;
}

export interface EngineLink {
  readonly init: (options: EngineLinkInit) => void;
  readonly ingest: (event: DeviceEvent) => void;
  readonly latestSnapshot: () => RideSnapshot | undefined;
  readonly recording: RecordingControls;
  readonly dispose: () => void;
}

interface PendingRequest {
  readonly resolve: (result: CaptureResult) => void;
  readonly reject: (error: Readonly<Error>) => void;
}

class WorkerLink implements EngineLink {
  private latest: RideSnapshot | undefined;
  private actorId: string | undefined;
  private disposed = false;
  private failed = false;
  private requestId = 0;
  private view: CaptureView = { kind: "unavailable", message: "Engine wird initialisiert …" };
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<(view: CaptureView) => void>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeFailure: () => void;

  constructor(
    private readonly port: EngineWorkerPort,
    private readonly callbacks: EngineLinkCallbacks,
    private readonly newId: () => string,
  ) {
    this.unsubscribe = port.subscribe((message) => {
      this.receive(message);
    });
    this.unsubscribeFailure = port.subscribeFailure((message) => {
      this.fail(message);
    });
  }

  private publish(view: CaptureView): void {
    this.view = view;

    for (const listener of this.listeners) listener(view);
  }

  private fail(message: string): void {
    this.failed = true;

    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
    this.publish({ kind: "unavailable", message });
    this.callbacks.onInitFailed?.(message);
  }

  private receive(message: EngineWorkerResponse): void {
    if (this.disposed || this.failed || message.actorId !== this.actorId) return;

    if (message.type === "engine.initFailed") {
      this.fail(message.message);

      return;
    }

    if (message.type === "recording.reply") {
      const pending = this.pending.get(message.requestId);

      if (pending === undefined) return;
      this.pending.delete(message.requestId);
      this.publish(message.result.view);

      if (message.result.kind === "failed") pending.reject(new Error(message.result.message));
      else pending.resolve(message.result);

      return;
    }

    this.latest = message.snapshot;
    this.publish(message.recording);
    this.callbacks.onSnapshot?.(message.snapshot);
    this.callbacks.onEvents?.(message.events);
    this.callbacks.onCommands?.(message.commands);
    this.callbacks.onProgress?.(message.progress);
  }

  init(options: EngineLinkInit): void {
    if (this.actorId !== undefined || this.disposed)
      throw new Error("Engine session already initialized or disposed.");
    this.actorId = this.newId();
    this.send({
      type: "engine.init",
      actorId: this.actorId,
      source: options.source,
      routeId: options.routeId,
      profile: options.profile,
      clockScale: options.clockScale ?? 1,
    });
  }

  ingest(event: DeviceEvent): void {
    if (this.actorId !== undefined && !this.disposed && !this.failed)
      this.send({ type: "engine.ingest", actorId: this.actorId, event });
  }

  latestSnapshot(): RideSnapshot | undefined {
    return this.latest;
  }

  private request(command: CaptureCommand): Promise<CaptureResult> {
    const actorId = this.actorId;

    if (actorId === undefined || this.disposed || this.failed)
      return Promise.reject(new Error("Engine nicht verfügbar."));
    this.requestId += 1;
    const requestId = this.requestId;

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });

      try {
        this.send({ type: "recording.command", actorId, requestId, command });
      } catch {
        this.pending.delete(requestId);
        reject(new Error("Worker-Nachricht fehlgeschlagen."));
      }
    });
  }

  readonly recording: RecordingControls = {
    state: () => this.view,
    subscribe: (listener) => {
      this.listeners.add(listener);

      return () => {
        this.listeners.delete(listener);
      };
    },
    start: async () => {
      await this.request({ kind: "start", rideId: this.newId() });
    },
    finish: async () => {
      const view = this.view;

      if (view.kind !== "recording") throw new Error("Keine laufende Aufnahme.");
      const result = await this.request({ kind: "finish", rideId: view.rideId });

      if (result.kind !== "finished") throw new Error("Aufnahmeabschluss fehlt.");

      return result.capture;
    },
    discard: async () => {
      const view = this.view;

      if (view.kind !== "recording") throw new Error("Keine laufende Aufnahme.");
      await this.request({ kind: "discard", rideId: view.rideId });
    },
    release: async (rideId) => {
      await this.request({ kind: "release", rideId });
    },
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.actorId !== undefined) this.send({ type: "engine.dispose", actorId: this.actorId });
    this.unsubscribe();
    this.unsubscribeFailure();

    for (const pending of this.pending.values()) pending.reject(new Error("Engine geschlossen."));
    this.pending.clear();
    this.publish({ kind: "unavailable", message: "Engine geschlossen." });
  }

  private send(message: EngineWorkerRequest): void {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated worker messages have no targetOrigin.
    this.port.postMessage(message);
  }
}

export function createEngineLink(
  port: EngineWorkerPort,
  callbacks: EngineLinkCallbacks = {},
  newId: () => string = () => crypto.randomUUID(),
): EngineLink {
  return new WorkerLink(port, callbacks, newId);
}
