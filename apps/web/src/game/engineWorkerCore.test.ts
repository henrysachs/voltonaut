import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
  WorkerScopeLike,
} from "./engineWorkerCore.js";
import { bindEngineWorker, WAKE_INTERVAL_MS } from "./engineWorkerCore.js";

interface FakeHarness {
  readonly scope: WorkerScopeLike;
  readonly posted: EngineWorkerResponse[];
  readonly send: (message: EngineWorkerRequest) => void;
}

function createFakeScope(): FakeHarness {
  const posted: EngineWorkerResponse[] = [];
  const handlers: ((event: { readonly data: EngineWorkerRequest }) => void)[] = [];

  return {
    posted,
    scope: {
      postMessage: (message: EngineWorkerResponse): void => {
        posted.push(message);
      },
      addEventListener: (
        _type: "message",
        listener: (event: { readonly data: EngineWorkerRequest }) => void,
      ): void => {
        handlers.push(listener);
      },
    },
    send: (message: EngineWorkerRequest): void => {
      for (const handler of handlers) {
        handler({ data: message });
      }
    },
  };
}

function createManualClock(startMs = 0) {
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
      for (const handler of handlers.values()) {
        handler();
      }
    },
    active: () => handlers.size,
  };
}

it("rejects an unknown route with engine.initFailed", () => {
  const fake = createFakeScope();

  bindEngineWorker(
    fake.scope,
    () => 0,
    () => 1,
    () => {},
  );

  fake.send({
    type: "engine.init",
    routeId: "does-not-exist",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });

  expect(fake.posted).toEqual([
    { type: "engine.initFailed", message: "unknown route does-not-exist" },
  ]);
});

it("runs one 0.05 s virtual tick per 50 ms real wake and posts updates", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);

  fake.send({
    type: "engine.init",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });

  const initSnapshot = fake.posted.find((message) => message.type === "engine.update");

  // The first wake only arms the clock.
  timers.tick();

  clock.advanceMs(50);
  timers.tick();

  const updates = fake.posted.filter((message) => message.type === "engine.update");
  const last = updates.at(-1);

  expect(initSnapshot).toBeDefined();
  expect(updates.length).toBeGreaterThanOrEqual(2);

  expect(last?.snapshot.tS).toBeCloseTo(0.05, 10);

  clock.advanceMs(50);
  timers.tick();

  const finalUpdate = fake.posted.findLast((message) => message.type === "engine.update");

  expect(finalUpdate?.snapshot.tS).toBeCloseTo(0.1, 10);
});

it("scales virtual time with the fast test clock", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
  fake.send({
    type: "engine.init",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 20,
  });

  timers.tick();
  clock.advanceMs(50);
  timers.tick();

  // 50 ms real x 20 => 1 s virtual => 20 ticks of 0.05 s.
  const update = fake.posted.findLast((message) => message.type === "engine.update");

  expect(update?.snapshot.tS).toBeCloseTo(1, 9);
});

it("forwards device events into the engine", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
  fake.send({
    type: "engine.init",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();

  fake.send({
    type: "engine.ingest",
    event: { type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 },
  });

  clock.advanceMs(50);
  timers.tick();

  const update = fake.posted.findLast((message) => message.type === "engine.update");

  expect(update?.snapshot.powerW).toBeGreaterThan(0);
});

it("stops the wake timer on dispose", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
  fake.send({
    type: "engine.init",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();

  expect(timers.active()).toBe(1);

  fake.send({ type: "engine.dispose" });

  expect(timers.active()).toBe(0);

  clock.advanceMs(100);
  timers.tick();

  const updateCount = fake.posted.filter((message) => message.type === "engine.update").length;

  expect(updateCount).toBe(1);
});
