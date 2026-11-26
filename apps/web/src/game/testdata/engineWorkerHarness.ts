import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import {
  bindEngineWorker,
  type EngineWorkerRequest,
  type EngineWorkerResponse,
  type WorkerScopeLike,
} from "../engineWorkerCore.js";
import type { RideInit } from "../recordedRide.js";
import type { CaptureCommand } from "../rideCaptureProtocol.js";
import { FIRST_RIDE_ID, TEST_LOOP_PATH } from "./recordedRideHarness.js";
import { createFakeTimers, createManualClock } from "./workerClock.js";

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
        worldPath: TEST_LOOP_PATH,
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
