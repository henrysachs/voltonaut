import type { DeviceEvent, RideEvent, RiderProfile, TrainerCommand } from "@voltonaut/shared";

import type { RideSnapshot } from "@voltonaut/engine";

import type { EngineWorkerRequest, EngineWorkerResponse } from "./engineWorkerCore.js";

/** Structural view of the main-thread side of the worker channel. */
export interface EngineWorkerPort {
  readonly postMessage: (message: EngineWorkerRequest) => void;
  readonly subscribe: (listener: (message: EngineWorkerResponse) => void) => () => void;
}

export interface EngineLinkCallbacks {
  readonly onSnapshot?: (snapshot: RideSnapshot) => void;
  readonly onEvents?: (events: readonly RideEvent[]) => void;
  readonly onCommands?: (commands: readonly TrainerCommand[]) => void;
  readonly onInitFailed?: (message: string) => void;
}

export interface EngineLinkInit {
  readonly routeId: string;
  readonly profile: RiderProfile;
  readonly clockScale?: number;
}

export interface EngineLink {
  /** Sends route + frozen profile; parameters only apply from the next ride on. */
  readonly init: (options: EngineLinkInit) => void;
  /** Forwards a device event into the worker (BLE runs on the main thread). */
  readonly ingest: (event: DeviceEvent) => void;
  readonly latestSnapshot: () => RideSnapshot | undefined;
  readonly dispose: () => void;
}

export function createEngineLink(
  port: EngineWorkerPort,
  callbacks: EngineLinkCallbacks = {},
): EngineLink {
  let latest: RideSnapshot | undefined;

  const unsubscribe = port.subscribe((message) => {
    if (message.type === "engine.update") {
      latest = message.snapshot;
      callbacks.onSnapshot?.(message.snapshot);
      callbacks.onEvents?.(message.events);
      callbacks.onCommands?.(message.commands);

      return;
    }

    callbacks.onInitFailed?.(message.message);
  });

  return {
    init(options: EngineLinkInit): void {
      port.postMessage({
        type: "engine.init",
        routeId: options.routeId,
        profile: options.profile,
        clockScale: options.clockScale ?? 1,
      });
    },

    ingest(event: DeviceEvent): void {
      port.postMessage({ type: "engine.ingest", event });
    },

    latestSnapshot(): RideSnapshot | undefined {
      return latest;
    },

    dispose(): void {
      port.postMessage({ type: "engine.dispose" });
      unsubscribe();
    },
  };
}
