import { expect } from "vitest";

import { WAKE_INTERVAL_MS } from "../engineWorkerCore.js";

/** The worker's `performance.now()` stand-in; only moves when a test moves it. */
export function createManualClock(startMs = 0) {
  let now = startMs;

  return {
    nowMs: () => now,
    advanceMs: (deltaMs: number) => {
      now += deltaMs;
    },
  };
}

/** `setInterval` stand-in for the worker wake timer; `tick` runs every scheduled wake once. */
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
