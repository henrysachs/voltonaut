import type { EngineWorkerRequest, EngineWorkerResponse } from "../engineWorkerCore.js";
import type { EngineWorkerPort } from "../engine-link.js";

export function createFakePort() {
  const listeners = new Set<(message: EngineWorkerResponse) => void>();
  const errors = new Set<(message: string) => void>();
  const sent: EngineWorkerRequest[] = [];

  const port: EngineWorkerPort = {
    postMessage: (message) => {
      sent.push(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    subscribeFailure: (listener) => {
      errors.add(listener);

      return () => {
        errors.delete(listener);
      };
    },
  };

  return {
    port,
    sent,
    deliver: (message: EngineWorkerResponse) => {
      for (const listener of listeners) listener(message);
    },
    fail: (message: string) => {
      for (const listener of errors) listener(message);
    },
  };
}
