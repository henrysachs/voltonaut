import { expect } from "vitest";

import {
  WAKE_INTERVAL_MS,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type WorkerScopeLike,
} from "../engineWorkerCore.js";

export function createFakeScope() {
  const posted: EngineWorkerResponse[] = [];
  let handler: ((event: { readonly data: EngineWorkerRequest }) => void) | undefined;

  const scope: WorkerScopeLike = {
    postMessage: (message) => {
      posted.push(message);
    },
    addEventListener: (_type, listener) => {
      handler = listener;
    },
  };

  return {
    scope,
    posted,
    send: (message: EngineWorkerRequest) => {
      handler?.({ data: message });
    },
  };
}

export function createManualClock(startMs = 0) {
  let now = startMs;

  return {
    nowMs: () => now,
    advanceMs: (deltaMs: number) => {
      now += deltaMs;
    },
  };
}

export function createFakeTimers() {
  const handlers = new Map<number, () => void>();
  let nextId = 1;

  return {
    schedule: (handler: () => void, intervalMs: number): number => {
      expect(intervalMs).toBe(WAKE_INTERVAL_MS);
      const id = nextId;
      nextId += 1;
      handlers.set(id, handler);

      return id;
    },
    cancel: (id: number) => {
      handlers.delete(id);
    },
    tick: () => {
      for (const handler of handlers.values()) handler();
    },
    active: () => handlers.size,
  };
}
