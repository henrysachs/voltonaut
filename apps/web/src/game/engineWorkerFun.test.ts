import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE, type RideMode } from "@voltonaut/shared";

import { bindEngineWorker } from "./engineWorkerCore.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const RIDE_ID = "550e8400-e29b-41d4-a716-446655440000";

function startedWorker() {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel, 0, () => RIDE_ID);
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
    routeId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();

  const wake = () => {
    clock.advanceMs(50);
    timers.tick();

    return fake.posted.findLast((message) => message.type === "engine.update");
  };

  const setMode = (mode: RideMode) => {
    fake.send({ type: "engine.setMode", actorId: "actor", mode });
  };

  const startRecording = () => {
    fake.send({
      type: "recording.command",
      actorId: "actor",
      requestId: 1,
      command: { kind: "start", rideId: RIDE_ID },
    });

    return fake.posted.findLast((message) => message.type === "recording.reply");
  };

  return { wake, setMode, startRecording };
}

it("setMode reaches the engine and fun mode posts no progress checkpoints", () => {
  const worker = startedWorker();

  expect(worker.wake()?.progress).toBeDefined();
  worker.setMode("fun");

  const update = worker.wake();

  expect(update?.snapshot.fun).toBeDefined();
  expect(update?.progress).toBeUndefined();
});

it("switching back to normal resumes progress", () => {
  const worker = startedWorker();

  worker.setMode("fun");
  worker.wake();
  worker.setMode("normal");

  const update = worker.wake();

  expect(update?.snapshot.fun).toBeUndefined();
  expect(update?.progress).toBeDefined();
});

it("refuses to start a recording in fun mode", () => {
  const worker = startedWorker();

  worker.setMode("fun");
  worker.wake();
  expect(worker.startRecording()?.result).toMatchObject({
    kind: "failed",
    message: "Im Spaß-Modus gibt es keine Aufnahme.",
  });
});

it("ignores a switch to fun mode while a recording is running", () => {
  const worker = startedWorker();

  expect(worker.startRecording()?.result.kind).not.toBe("failed");
  worker.setMode("fun");

  const update = worker.wake();

  expect(update?.snapshot.fun).toBeUndefined();
  expect(update?.progress).toBeDefined();
});
