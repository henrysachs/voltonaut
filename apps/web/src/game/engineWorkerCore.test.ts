import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE, type DeviceEvent } from "@voltonaut/shared";

import { bindEngineWorker } from "./engineWorkerCore.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const unarmedCapture = {
  type: "recording.reply",
  result: {
    kind: "finished",
    capture: {
      kind: "journal",
      recording: {
        schemaVersion: 2,
        initializedAt: "2026-11-20T00:00:00.100Z",
        observations: [
          { snapshot: { tS: 0, distanceM: 0 } },
          { snapshot: { tS: 0, distanceM: 0 } },
        ],
        entries: [
          [0, 100, "trainer", 200, 90, null],
          [1, 100, "boundary", "start"],
          [2, 1100, "arm"],
          [3, 1100, "boundary", "finish"],
        ],
      },
    },
  },
};

const trainerReading = {
  type: "trainer.data",
  tS: 999,
  powerW: 200,
  cadenceRpm: 90,
} satisfies DeviceEvent;

it("captures the committed worker state without advancing or arming on recording commands", () => {
  const fake = createFakeScope();
  const clock = createManualClock(100);
  const timers = createFakeTimers();
  bindEngineWorker(
    fake.scope,
    clock.nowMs,
    timers.schedule,
    timers.cancel,
    Date.parse("2026-11-20T00:00:00.000Z"),
  );
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
    routeId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  fake.send({
    type: "engine.ingest",
    actorId: "actor",
    event: trainerReading,
  });
  fake.send({
    type: "recording.command",
    actorId: "actor",
    requestId: 1,
    command: { kind: "start", rideId: "550e8400-e29b-41d4-a716-446655440000" },
  });
  clock.advanceMs(1000);
  timers.tick();
  fake.send({
    type: "recording.command",
    actorId: "actor",
    requestId: 2,
    command: { kind: "finish", rideId: "550e8400-e29b-41d4-a716-446655440000" },
  });
  const reply = fake.posted.findLast((message) => message.type === "recording.reply");
  expect(reply).toMatchObject(unarmedCapture);
  clock.advanceMs(50);
  timers.tick();
  const update = fake.posted.findLast((message) => message.type === "engine.update");
  expect(update?.snapshot.tS).toBeCloseTo(0.05, 10);
  expect(JSON.stringify(update)).not.toContain('"entries"');
});

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
    actorId: "actor",
    source: "sim",
    routeId: "does-not-exist",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });

  expect(fake.posted).toEqual([
    { type: "engine.initFailed", actorId: "actor", message: "unknown route does-not-exist" },
  ]);
});

it("runs one 0.05 s virtual tick per 50 ms real wake and posts updates", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(
    fake.scope,
    clock.nowMs,
    timers.schedule,
    timers.cancel,
    0,
    () => "550e8400-e29b-41d4-a716-446655440000",
  );

  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
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
  expect(last?.progress).toMatchObject({ sequence: 0, startTick: 0, endTick: 1 });
  expect(last?.progress?.facts).toHaveLength(1);
  expect(initSnapshot?.progress).toBeUndefined();

  clock.advanceMs(50);
  timers.tick();

  const finalUpdate = fake.posted.findLast((message) => message.type === "engine.update");

  expect(finalUpdate?.snapshot.tS).toBeCloseTo(0.1, 10);
  expect(finalUpdate?.progress).toMatchObject({ sequence: 1, startTick: 1, endTick: 2 });
});

it("scales virtual time with the fast test clock", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
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
  expect(update?.progress).toMatchObject({ clockScale: 20, startTick: 0, endTick: 20 });
  expect(update?.progress?.facts).toHaveLength(20);
});

it("forwards device events into the engine", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();

  fake.send({
    type: "engine.ingest",
    actorId: "actor",
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
    actorId: "actor",
    source: "sim",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();

  expect(timers.active()).toBe(1);

  fake.send({ type: "engine.dispose", actorId: "actor" });

  expect(timers.active()).toBe(0);

  clock.advanceMs(100);
  timers.tick();

  const updateCount = fake.posted.filter((message) => message.type === "engine.update").length;

  expect(updateCount).toBe(1);
});
