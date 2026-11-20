import { bindEngineWorker } from "./engineWorkerCore.js";
import type { WorkerScopeLike } from "./engineWorkerCore.js";

/** Boots the engine inside a dedicated worker (see engineWorkerCore for the protocol). */
export function startEngineWorker(
  scope: WorkerScopeLike,
  nowMs: () => number = () => performance.now(),
  schedule: (handler: () => void, intervalMs: number) => number = (handler, intervalMs) =>
    self.setInterval(handler, intervalMs),
  cancel: (intervalId: number) => void = (intervalId) => {
    self.clearInterval(intervalId);
  },
): void {
  bindEngineWorker(scope, nowMs, schedule, cancel);
}

// SAFETY: inside a module worker, self is the DedicatedWorkerGlobalScope; the
// existence probe keeps this module importable from unit tests outside a worker.
if (typeof self !== "undefined") {
  startEngineWorker(self);
}
