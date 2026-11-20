import type { DeviceEvent, RideEvent, RiderProfile, TrainerCommand } from "@voltonaut/shared";

import type { RideSnapshot } from "@voltonaut/engine";
import { createEngine, createRoute, TEST_ROUTES, type Engine } from "@voltonaut/engine";

/** Main thread -> worker messages. */
export type EngineWorkerRequest =
  | {
      readonly type: "engine.init";
      readonly routeId: string;
      readonly profile: RiderProfile;
      /** Virtual seconds per real second (sim test clock: ?clock=fast => 20). */
      readonly clockScale: number;
    }
  | { readonly type: "engine.ingest"; readonly event: DeviceEvent }
  | { readonly type: "engine.dispose" };

/** Worker -> main thread messages. */
export type EngineWorkerResponse =
  | {
      readonly type: "engine.update";
      readonly snapshot: RideSnapshot;
      readonly events: readonly RideEvent[];
      readonly commands: readonly TrainerCommand[];
    }
  | { readonly type: "engine.initFailed"; readonly message: string };

/** Minimal structural view of the worker global scope; the DOM one satisfies it. */
export interface WorkerScopeLike {
  readonly postMessage: (message: EngineWorkerResponse) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: EngineWorkerRequest }) => void,
  ) => void;
}

export type ScheduleInterval = (handler: () => void, intervalMs: number) => number;

export type CancelInterval = (intervalId: number) => void;

/** The worker wakes the accumulator at a fixed real interval (spec E3-01 AK9). */
export const WAKE_INTERVAL_MS = 50;

interface EngineWorkerState {
  engine: Engine | undefined;
  clockScale: number;
  lastWakeMs: number | undefined;
  intervalId: number | undefined;
}

function createWake(
  scope: WorkerScopeLike,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The worker driver owns and updates its clock and engine lifecycle state.
  state: EngineWorkerState,
  nowMs: () => number,
): () => void {
  return (): void => {
    const engine = state.engine;

    if (engine === undefined) {
      return;
    }

    const now = nowMs();

    if (state.lastWakeMs === undefined) {
      state.lastWakeMs = now;

      return;
    }

    const elapsedRealS = (now - state.lastWakeMs) / 1000;

    state.lastWakeMs = now;
    engine.advance(elapsedRealS * state.clockScale);

    postUpdate(scope, engine);
  };
}

function postUpdate(scope: WorkerScopeLike, engine: Engine): void {
  scope.postMessage({
    type: "engine.update",
    snapshot: engine.snapshot(),
    events: engine.drainEvents(),
    commands: engine.drainCommands(),
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker postMessage has no targetOrigin; the lint reports this multiline call at its closing parenthesis.
  });
}

function handleInit(
  scope: WorkerScopeLike,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Initialization installs the engine and timer into worker-owned lifecycle state.
  state: EngineWorkerState,
  wake: () => void,
  schedule: ScheduleInterval,
  message: {
    readonly routeId: string;
    readonly profile: RiderProfile;
    readonly clockScale: number;
  },
): void {
  const routeData = TEST_ROUTES[message.routeId];

  if (routeData === undefined) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker-scope postMessage has no targetOrigin parameter; that rule only applies to window messaging.
    scope.postMessage({ type: "engine.initFailed", message: `unknown route ${message.routeId}` });

    return;
  }

  const engine = createEngine({ route: createRoute(routeData), profile: message.profile });

  state.engine = engine;
  state.clockScale = message.clockScale > 0 ? message.clockScale : 1;
  state.lastWakeMs = undefined;
  state.intervalId = schedule(wake, WAKE_INTERVAL_MS);

  // Initial update so the main thread renders immediately.
  postUpdate(scope, engine);
}

function handleMessage(
  scope: WorkerScopeLike,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Init and dispose mutate the worker-owned engine and timer lifecycle.
  state: EngineWorkerState,
  wake: () => void,
  schedule: ScheduleInterval,
  cancel: CancelInterval,
  message: EngineWorkerRequest,
): void {
  if (message.type === "engine.init") {
    handleInit(scope, state, wake, schedule, message);

    return;
  }

  if (message.type === "engine.ingest") {
    state.engine?.ingest(message.event);

    return;
  }

  // Remaining message type: engine.dispose.
  if (state.intervalId !== undefined) {
    cancel(state.intervalId);
    state.intervalId = undefined;
  }

  state.engine = undefined;
}

/**
 * Binds the engine driver to a worker scope: time enters exclusively as
 * elapsed seconds (accumulator with the 120-tick catch-up cap inside the
 * engine); BLE events arrive via postMessage because Bluetooth only runs on
 * the main thread.
 */
export function bindEngineWorker(
  scope: WorkerScopeLike,
  nowMs: () => number,
  schedule: ScheduleInterval,
  cancel: CancelInterval,
): void {
  const state: EngineWorkerState = {
    engine: undefined,
    clockScale: 1,
    lastWakeMs: undefined,
    intervalId: undefined,
  };

  const wake = createWake(scope, state, nowMs);

  scope.addEventListener("message", (event) => {
    handleMessage(scope, state, wake, schedule, cancel, event.data);
  });
}
