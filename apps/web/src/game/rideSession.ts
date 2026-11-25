import { TEST_ROUTES, type RideSnapshot } from "@voltonaut/engine";
import type {
  DeviceEvent,
  EventBus,
  RideMode,
  RideProgressCheckpoint,
  RiderProfile,
  TrainerCommand,
} from "@voltonaut/shared";

import { createConnectionMonitor } from "./connectionMonitor.js";
import { createEngineLink, type EngineLink, type EngineWorkerPort } from "./engine-link.js";
import type { EngineWorkerResponse } from "./engineWorkerCore.js";
import type { RecordingControls } from "./rideCaptureProtocol.js";
import { createSegmentProjector, type SegmentHudView, type SegmentProjector } from "./segments.js";

/** Bus events the worker consumes: engine inputs plus the device status the recorder journals. */
export const ENGINE_INPUT_TYPES = [
  "trainer.data",
  "hr.data",
  "controller.button",
  "device.status",
] as const satisfies readonly DeviceEvent["type"][];

export interface RideTrainerSink {
  readonly onSnapshot: (snapshot: RideSnapshot) => void;
  readonly onCommands: (commands: readonly TrainerCommand[]) => void;
}

export interface RideSessionOptions {
  readonly bus: EventBus;
  readonly routeId: string;
  /** Frozen at ride start; profile edits apply to the next ride. */
  readonly profile: RiderProfile;
  readonly source: "sim" | "ble";
  readonly clockScale: number;
  /** Trainer control sink; receives every snapshot before that update's commands. */
  readonly trainer?: RideTrainerSink | undefined;
  readonly onProgress?: ((checkpoint: RideProgressCheckpoint | undefined) => void) | undefined;
}

/** The running ride on the main thread. The worker owns state; this is its read model and intents. */
export interface RideSession {
  readonly routeId: string;
  readonly profile: RiderProfile;
  readonly snapshot: () => RideSnapshot | undefined;
  /** True while at least one trainer reports ready. */
  readonly connected: () => boolean;
  readonly segments: () => SegmentHudView;
  /** Mode the engine's last tick ran in (ADR-028); undefined before the first update. */
  readonly mode: () => RideMode | undefined;
  /** Mode intent; the worker refuses unrecordable modes during a recording. */
  readonly requestMode: (mode: RideMode) => void;
  readonly recording: RecordingControls;
  /** Called after every worker update and every recording reply. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
}

function createWorkerPort(): EngineWorkerPort {
  const worker = new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module" });

  return {
    subscribeFailure: (listener) => {
      const handler = (): void => {
        listener("Engine-Worker ausgefallen. Ungespeicherte Aufnahme möglicherweise verloren.");
      };

      worker.addEventListener("error", handler);
      worker.addEventListener("messageerror", handler);

      return () => {
        worker.removeEventListener("error", handler);
        worker.removeEventListener("messageerror", handler);
      };
    },
    postMessage: (message) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker.postMessage has no targetOrigin parameter; that rule only applies to window messaging.
      worker.postMessage(message);
    },
    subscribe: (listener) => {
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- MessageEvent is the DOM listener contract type.
      const handler = (event: MessageEvent<EngineWorkerResponse>): void => {
        listener(event.data);
      };

      worker.addEventListener("message", handler);

      return () => {
        worker.removeEventListener("message", handler);
      };
    },
  };
}

/** Initializes the worker actor and fans each update out to trainer, segments and progress. */
function startEngine(
  options: RideSessionOptions,
  segments: SegmentProjector,
  port: EngineWorkerPort,
  newId: (() => string) | undefined,
): EngineLink {
  return createEngineLink(
    port,
    {
      routeId: options.routeId,
      profile: options.profile,
      source: options.source,
      clockScale: options.clockScale,
    },
    {
      onUpdate: (update) => {
        options.trainer?.onSnapshot(update.snapshot);
        segments.consume({ events: update.events, snapshot: update.snapshot });
        options.trainer?.onCommands(update.commands);
        options.onProgress?.(update.progress);
      },
      onFailure: () => {
        segments.unavailable();
      },
    },
    newId,
  );
}

/**
 * Starts the ride: resolves the route, initializes the engine worker, then forwards
 * device events from the bus. Rejects unknown routes before a worker exists.
 */
export function createRideSession(
  options: RideSessionOptions,
  newPort: () => EngineWorkerPort = createWorkerPort,
  newId?: () => string,
): RideSession {
  const route = TEST_ROUTES[options.routeId];

  if (route === undefined) throw new Error(`Unknown route: ${options.routeId}`);

  const segments = createSegmentProjector(route);
  const connection = createConnectionMonitor(options.bus);
  // The link sends engine.init on creation, so no bus event can reach the worker first.
  const link = startEngine(options, segments, newPort(), newId);

  const forward = (event: DeviceEvent): void => {
    link.ingest(event);
  };

  const unsubscribes = ENGINE_INPUT_TYPES.map((type) => options.bus.subscribe(type, forward));

  return {
    routeId: options.routeId,
    profile: options.profile,
    snapshot: () => link.latestSnapshot(),
    connected: () => connection.state().connected,
    segments: () => segments.view(),
    mode: () => link.latestSnapshot()?.mode.kind,
    requestMode: (mode) => {
      link.setMode(mode);
    },
    recording: link.recording,
    // The link publishes the recording view on every update and reply.
    subscribe: (listener) =>
      link.recording.subscribe(() => {
        listener();
      }),
    dispose: () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      connection.dispose();
      link.dispose();
      segments.unavailable();
    },
  };
}
