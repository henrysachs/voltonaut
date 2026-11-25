import { expect } from "vitest";

import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import {
  bindEngineWorker,
  WAKE_INTERVAL_MS,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type WorkerScopeLike,
} from "../engineWorkerCore.js";
import type { RideInit } from "../recordedRide.js";
import type { CaptureCommand } from "../rideCaptureProtocol.js";
import { FIRST_RIDE_ID } from "./recordedRideHarness.js";

type EngineUpdate = Extract<EngineWorkerResponse, { readonly type: "engine.update" }>;

function createFakeScope() {
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

function createManualClock(startMs: number) {
  let now = startMs;

  return {
    nowMs: () => now,
    advanceMs: (deltaMs: number) => {
      now += deltaMs;
    },
  };
}

function createFakeTimers() {
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

/**
 * Binds the real worker driver to a fake scope, manual clock and fake timers.
 * Only dispatch and timer scheduling belong here; ride behaviour is tested on
 * `recordedRide` directly.
 */
export function createWorkerHarness(
  options: { readonly startMs?: number; readonly timeOriginMs?: number } = {},
) {
  const fake = createFakeScope();
  const clock = createManualClock(options.startMs ?? 0);
  const timers = createFakeTimers();

  bindEngineWorker(
    fake.scope,
    clock.nowMs,
    timers.schedule,
    timers.cancel,
    options.timeOriginMs ?? 0,
    () => FIRST_RIDE_ID,
  );

  return {
    posted: fake.posted,
    send: fake.send,
    timers,
    init: (actorId: string, init: Partial<RideInit> = {}) => {
      fake.send({
        type: "engine.init",
        actorId,
        source: "sim",
        routeId: "test-loop",
        profile: DEFAULT_RIDER_PROFILE,
        clockScale: 1,
        ...init,
      });
    },
    wake: (elapsedMs: number) => {
      clock.advanceMs(elapsedMs);
      timers.tick();
    },
    command: (actorId: string, requestId: number, command: CaptureCommand) => {
      fake.send({ type: "recording.command", actorId, requestId, command });

      return fake.posted.findLast((message) => message.type === "recording.reply");
    },
    updates: (): EngineUpdate[] =>
      fake.posted.filter((message): message is EngineUpdate => message.type === "engine.update"),
  };
}
