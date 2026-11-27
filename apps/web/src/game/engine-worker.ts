import { bindEngineWorker } from "./engineWorkerCore.js";

// Boots the engine inside a dedicated worker (see engineWorkerCore for the protocol).
// SAFETY: inside a module worker, self is the DedicatedWorkerGlobalScope; the
// existence probe keeps this module importable from unit tests outside a worker.
if (typeof self !== "undefined") {
  bindEngineWorker(
    self,
    () => performance.now(),
    (handler, intervalMs) => self.setInterval(handler, intervalMs),
    (intervalId) => {
      self.clearInterval(intervalId);
    },
    performance.timeOrigin,
  );
}
