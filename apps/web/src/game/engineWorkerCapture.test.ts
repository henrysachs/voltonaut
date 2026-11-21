import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import { bindEngineWorker } from "./engineWorkerCore.js";
import type { CaptureCommand } from "./rideCaptureProtocol.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const firstId = "550e8400-e29b-41d4-a716-446655440000";
const secondId = "550e8400-e29b-41d4-a716-446655440001";

const frozenMetadataReply = {
  type: "recording.reply",
  result: {
    kind: "finished",
    capture: {
      kind: "journal",
      recording: {
        rideId: firstId,
        initialization: {
          profile: DEFAULT_RIDER_PROFILE,
          source: "sim",
          routeId: "test-loop",
          clockScale: 1,
        },
      },
    },
  },
};

function setup() {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();
  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
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
    event: { type: "trainer.data", tS: 999, powerW: 200, cadenceRpm: 90 },
  });
  timers.tick();

  return {
    ...fake,
    clock,
    timers,
    command: (requestId: number, command: CaptureCommand) => {
      fake.send({ type: "recording.command", actorId: "actor", requestId, command });

      return fake.posted.findLast((message) => message.type === "recording.reply");
    },
  };
}

it("rejects duplicate, late ride and foreign actor commands without overwriting completion", () => {
  const run = setup();
  run.command(1, { kind: "start", rideId: firstId });
  run.clock.advanceMs(1000);
  run.timers.tick();
  expect(run.command(2, { kind: "finish", rideId: firstId })).toMatchObject({
    result: { kind: "finished" },
  });
  expect(run.command(2, { kind: "finish", rideId: firstId })).toMatchObject({
    result: { kind: "failed" },
  });
  expect(run.command(3, { kind: "start", rideId: secondId })).toMatchObject({
    result: { kind: "failed" },
  });
  expect(run.command(4, { kind: "release", rideId: secondId })).toMatchObject({
    result: { kind: "failed" },
  });
  expect(run.command(5, { kind: "release", rideId: firstId })).toMatchObject({
    result: { kind: "state", view: { kind: "idle" } },
  });
  run.command(6, { kind: "start", rideId: secondId });
  expect(run.command(7, { kind: "finish", rideId: firstId })).toMatchObject({
    result: { kind: "failed", view: { rideId: secondId } },
  });
  run.send({ type: "engine.dispose", actorId: "old" });
  run.send({
    type: "recording.command",
    actorId: "old",
    requestId: 99,
    command: { kind: "discard", rideId: secondId },
  });
  run.clock.advanceMs(50);
  run.timers.tick();
  expect(
    run.posted
      .filter((message) => message.type === "recording.reply")
      .filter((message) => message.result.kind === "finished"),
  ).toHaveLength(1);
  expect(
    run.posted.findLast((message) => message.type === "engine.update")?.snapshot.tS,
  ).toBeCloseTo(1.05, 10);
  expect(run.timers.active()).toBe(1);
});

it("preserves same-clock actor order and samples the actual committed state without an extra advance", () => {
  const run = setup();
  run.clock.advanceMs(25);
  run.command(1, { kind: "start", rideId: firstId });
  run.send({
    type: "engine.ingest",
    actorId: "actor",
    event: {
      type: "controller.button",
      tS: -999,
      button: "shiftUp",
      pressed: true,
      source: "test",
    },
  });
  run.clock.advanceMs(50);
  run.timers.tick();
  run.clock.advanceMs(950);
  const reply = run.command(2, { kind: "finish", rideId: firstId });
  expect(reply).toMatchObject({
    result: {
      kind: "finished",
      capture: {
        kind: "journal",
        recording: {
          entries: [
            [0, 0, "trainer", 200, 90, null],
            [1, 0, "arm"],
            [2, 25, "boundary", "start"],
            [3, 25, "shift", "shiftUp"],
            [4, 75, "advance", 0.075],
            [5, 1025, "boundary", "finish"],
          ],
          observations: [{ snapshot: { tS: 0 } }, { snapshot: { tS: 0.05 } }],
        },
      },
    },
  });
  expect(run.posted.filter((message) => message.type === "engine.update")).toHaveLength(2);
});

it("stops scheduling on disposal but retains an unsecured completion until matching release", () => {
  const run = setup();
  run.command(1, { kind: "start", rideId: firstId });
  run.clock.advanceMs(1000);
  run.timers.tick();
  run.command(2, { kind: "finish", rideId: firstId });
  run.send({ type: "engine.dispose", actorId: "actor" });
  expect(run.timers.active()).toBe(0);
  run.send({
    type: "engine.init",
    actorId: "next",
    source: "sim",
    routeId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  expect(run.posted.at(-1)).toMatchObject({ type: "engine.initFailed", actorId: "next" });
  expect(run.command(3, { kind: "release", rideId: secondId })).toMatchObject({
    result: { kind: "failed", view: { kind: "completed", rideId: firstId } },
  });
  run.command(4, { kind: "release", rideId: firstId });
  run.send({
    type: "engine.init",
    actorId: "next",
    source: "sim",
    routeId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  expect(run.posted.at(-1)).toMatchObject({
    type: "engine.update",
    actorId: "next",
    snapshot: { tS: 0 },
  });
  run.send({
    type: "engine.ingest",
    actorId: "actor",
    event: { type: "trainer.data", tS: 0, powerW: 2000, cadenceRpm: 200 },
  });
  run.clock.advanceMs(50);
  run.timers.tick();
  run.clock.advanceMs(50);
  run.timers.tick();
  expect(run.posted.findLast((message) => message.type === "engine.update")?.snapshot.powerW).toBe(
    0,
  );
});

it("freezes initialization metadata independently of later caller profile edits", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();
  const profile = { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike } };
  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel);
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
    routeId: "test-loop",
    profile,
    clockScale: 1,
  });
  profile.massKg = 140;
  profile.bike.massKg = 20;
  fake.send({
    type: "engine.ingest",
    actorId: "actor",
    event: { type: "trainer.data", tS: 0, powerW: 200, cadenceRpm: 90 },
  });
  fake.send({
    type: "recording.command",
    actorId: "actor",
    requestId: 1,
    command: { kind: "start", rideId: firstId },
  });
  timers.tick();
  clock.advanceMs(1000);
  timers.tick();
  fake.send({
    type: "recording.command",
    actorId: "actor",
    requestId: 2,
    command: { kind: "finish", rideId: firstId },
  });
  expect(fake.posted.at(-1)).toMatchObject(frozenMetadataReply);
});

it("delivers the same real engine outputs to the main channel and journal without a second drain", () => {
  const run = setup();
  run.command(1, { kind: "start", rideId: firstId });
  run.clock.advanceMs(1000);
  run.timers.tick();
  const update = run.posted.findLast((message) => message.type === "engine.update");
  run.command(2, { kind: "finish", rideId: firstId });

  const recordings = run.posted
    .filter((message) => message.type === "recording.reply")
    .map((message) => message.result)
    .filter((result) => result.kind === "finished")
    .map((result) => result.capture)
    .filter((capture) => capture.kind === "journal")
    .map((capture) => capture.recording);

  expect(recordings).toHaveLength(1);
  expect(update?.commands.length).toBeGreaterThan(0);
  expect(
    recordings
      .flatMap((recording) => recording.observations)
      .flatMap((observation) => observation.commands),
  ).toEqual(update?.commands);
  expect(
    recordings
      .flatMap((recording) => recording.observations)
      .flatMap((observation) => observation.events),
  ).toEqual(update?.events);
});
