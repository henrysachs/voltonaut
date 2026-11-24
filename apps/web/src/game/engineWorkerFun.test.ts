import { expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE, type RideMode } from "@voltonaut/shared";

import { bindEngineWorker } from "./engineWorkerCore.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const RIDE_ID = "550e8400-e29b-41d4-a716-446655440000";

type FakeScope = ReturnType<typeof createFakeScope>;

/** Recording start/finish with increasing request ids; returns the latest reply. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fake worker scope records posted messages in mutable arrays.
function recordingCommands(fake: FakeScope) {
  let requestId = 0;

  return (kind: "start" | "finish") => {
    requestId += 1;
    fake.send({
      type: "recording.command",
      actorId: "actor",
      requestId,
      command: { kind, rideId: RIDE_ID },
    });

    return fake.posted.findLast((message) => message.type === "recording.reply");
  };
}

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

  const rideFor = (seconds: number) => {
    for (let elapsedMs = 0; elapsedMs < seconds * 1000; elapsedMs += 50) {
      fake.send({
        type: "engine.ingest",
        actorId: "actor",
        event: { type: "trainer.data", tS: elapsedMs / 1000, powerW: 250, cadenceRpm: 90 },
      });
      wake();
    }
  };

  const setMode = (mode: RideMode) => {
    fake.send({ type: "engine.setMode", actorId: "actor", mode });
  };

  const recording = recordingCommands(fake);

  return {
    wake,
    rideFor,
    setMode,
    startRecording: () => recording("start"),
    finishRecording: () => recording("finish"),
  };
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

it("marks later recordings of the session local-only with reason fun_mode", () => {
  const worker = startedWorker();

  worker.setMode("fun");
  worker.wake();
  worker.setMode("normal");
  worker.wake();
  worker.startRecording();
  worker.rideFor(1.5);
  expect(worker.finishRecording()?.result).toMatchObject({
    kind: "finished",
    capture: { kind: "local_only", reason: "fun_mode" },
  });
});

it("keeps verifiable journal recordings when fun mode was never used", () => {
  const worker = startedWorker();

  worker.wake();
  worker.startRecording();
  worker.rideFor(1.5);
  expect(worker.finishRecording()?.result).toMatchObject({
    kind: "finished",
    capture: { kind: "journal" },
  });
});
