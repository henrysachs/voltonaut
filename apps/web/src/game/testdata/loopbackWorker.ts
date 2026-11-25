import type { EngineWorkerPort } from "../engine-link.js";
import {
  bindEngineWorker,
  WAKE_INTERVAL_MS,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
} from "../engineWorkerCore.js";
import { createFakeTimers, createManualClock } from "./engineWorkerHarness.js";

type Delivery =
  | { readonly to: "worker"; readonly message: EngineWorkerRequest }
  | { readonly to: "main"; readonly message: EngineWorkerResponse };

/** Both message directions, queued and structured-cloned like `postMessage`. */
function createChannel() {
  const queue: Delivery[] = [];
  const mainListeners = new Set<(message: EngineWorkerResponse) => void>();
  let workerListener: ((event: { readonly data: EngineWorkerRequest }) => void) | undefined;

  const port: EngineWorkerPort = {
    postMessage: (message) => {
      queue.push({ to: "worker", message: structuredClone(message) });
    },
    subscribe: (listener) => {
      mainListeners.add(listener);

      return () => {
        mainListeners.delete(listener);
      };
    },
    subscribeFailure: () => () => {},
  };

  return {
    port,
    scope: {
      postMessage: (message: EngineWorkerResponse) => {
        queue.push({ to: "main", message: structuredClone(message) });
      },
      addEventListener: (
        _type: "message",
        listener: (event: { readonly data: EngineWorkerRequest }) => void,
      ) => {
        workerListener = listener;
      },
    },
    /** Delivers queued messages in order, including the replies they cause, until both sides idle. */
    flush: (): void => {
      for (let delivery = queue.shift(); delivery !== undefined; delivery = queue.shift()) {
        if (delivery.to === "worker") workerListener?.({ data: delivery.message });
        else for (const listener of mainListeners) listener(delivery.message);
      }
    },
  };
}

/**
 * Second real adapter at the worker seam: an `EngineWorkerPort` wired in-process to
 * the real worker driver with a manual clock. Nothing moves until `flush` or `advanceMs`.
 */
export function createLoopbackWorker(startMs = 0, timeOriginMs = 0) {
  const clock = createManualClock(startMs);
  const timers = createFakeTimers();
  const channel = createChannel();
  let ids = 0;

  bindEngineWorker(channel.scope, clock.nowMs, timers.schedule, timers.cancel, timeOriginMs, () => {
    ids += 1;

    return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
  });

  return {
    port: channel.port,
    flush: channel.flush,
    /** Moves the worker clock in wake intervals; each wake runs and its update is delivered. */
    advanceMs: (deltaMs: number): void => {
      channel.flush();

      for (let elapsedMs = 0; elapsedMs < deltaMs; elapsedMs += WAKE_INTERVAL_MS) {
        clock.advanceMs(WAKE_INTERVAL_MS);
        timers.tick();
        channel.flush();
      }
    },
    activeTimers: timers.active,
  };
}
