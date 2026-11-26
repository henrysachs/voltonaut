import { expect, it } from "vitest";

import {
  FIRST_RIDE_ID,
  SECOND_RIDE_ID,
  singleRouteWorldPath,
  TRAINER_READING,
} from "./testdata/recordedRideHarness.js";
import { createWorkerHarness } from "./testdata/engineWorkerHarness.js";

it("rejects an unknown world path with engine.initFailed and schedules nothing", () => {
  const worker = createWorkerHarness();

  worker.init("actor", { worldPath: singleRouteWorldPath("does-not-exist") });

  expect(worker.posted).toEqual([
    {
      type: "engine.initFailed",
      actorId: "actor",
      message: "unknown world path: World does-not-exist, revision 1, path does-not-exist",
    },
  ]);
  expect(worker.timers.active()).toBe(0);
});

it("posts the init update, arms on the first wake and posts one update per later wake", () => {
  const worker = createWorkerHarness();

  worker.init("actor");
  expect(worker.updates()).toHaveLength(1);
  expect(worker.updates()[0]).toMatchObject({ actorId: "actor", snapshot: { tS: 0 } });
  expect(worker.timers.active()).toBe(1);

  worker.timers.tick();
  expect(worker.updates()).toHaveLength(1);

  worker.wake(50);
  expect(worker.updates()).toHaveLength(2);
  expect(worker.updates().at(-1)?.snapshot.tS).toBeCloseTo(0.05, 10);
});

it("dispatches ingest, mode and capture to the active actor only", () => {
  const worker = createWorkerHarness();

  worker.init("actor");
  worker.timers.tick();
  worker.send({ type: "engine.ingest", actorId: "other", event: TRAINER_READING });
  worker.send({ type: "engine.setMode", actorId: "other", mode: "fun" });
  worker.command("other", 1, { kind: "start", rideId: FIRST_RIDE_ID });
  worker.send({ type: "engine.dispose", actorId: "other" });
  worker.wake(50);

  expect(worker.updates().at(-1)).toMatchObject({
    snapshot: { powerW: 0, mode: { kind: "normal" } },
    recording: { kind: "idle" },
  });
  expect(worker.timers.active()).toBe(1);

  worker.send({ type: "engine.ingest", actorId: "actor", event: TRAINER_READING });
  worker.send({ type: "engine.setMode", actorId: "actor", mode: "fun" });
  worker.wake(50);

  expect(worker.updates().at(-1)).toMatchObject({
    actorId: "actor",
    snapshot: { mode: { kind: "fun" } },
  });
  expect(worker.updates().at(-1)?.snapshot.powerW).toBeGreaterThan(0);
  expect(worker.command("actor", 2, { kind: "start", rideId: FIRST_RIDE_ID })).toMatchObject({
    type: "recording.reply",
    actorId: "actor",
    requestId: 2,
    result: { kind: "failed" },
  });
});

it("stops the wake timer on dispose but holds an unsecured completion until release", () => {
  const worker = createWorkerHarness();

  worker.init("actor");
  worker.send({ type: "engine.ingest", actorId: "actor", event: TRAINER_READING });
  worker.timers.tick();
  worker.command("actor", 1, { kind: "start", rideId: FIRST_RIDE_ID });
  worker.wake(1000);
  worker.command("actor", 2, { kind: "finish", rideId: FIRST_RIDE_ID });
  worker.send({ type: "engine.dispose", actorId: "actor" });
  expect(worker.timers.active()).toBe(0);

  worker.init("next");
  expect(worker.posted.at(-1)).toMatchObject({ type: "engine.initFailed", actorId: "next" });
  expect(worker.command("actor", 3, { kind: "release", rideId: SECOND_RIDE_ID })).toMatchObject({
    result: { kind: "failed", view: { kind: "completed", rideId: FIRST_RIDE_ID } },
  });

  worker.command("actor", 4, { kind: "release", rideId: FIRST_RIDE_ID });
  worker.init("next");
  expect(worker.posted.at(-1)).toMatchObject({
    type: "engine.update",
    actorId: "next",
    snapshot: { tS: 0 },
  });

  worker.send({
    type: "engine.ingest",
    actorId: "actor",
    event: { type: "trainer.data", tS: 0, powerW: 2000, cadenceRpm: 200 },
  });
  worker.timers.tick();
  worker.wake(50);
  expect(worker.updates().at(-1)).toMatchObject({ actorId: "next", snapshot: { powerW: 0 } });
});

it("drops a disposed idle actor so a fresh init succeeds immediately", () => {
  const worker = createWorkerHarness();

  worker.init("first");
  worker.send({ type: "engine.dispose", actorId: "first" });
  worker.wake(100);
  expect(worker.updates()).toHaveLength(1);

  worker.init("second");
  expect(worker.posted.at(-1)).toMatchObject({ type: "engine.update", actorId: "second" });
});

it("stamps progress with the bound time origin and identity source", () => {
  const worker = createWorkerHarness({ startMs: 0.4, timeOriginMs: 1000 });

  worker.init("actor");
  worker.timers.tick();
  worker.wake(50);

  expect(worker.updates().at(-1)?.progress).toMatchObject({
    journalId: FIRST_RIDE_ID,
    startedAtMs: 1000,
    endedAtMs: 1050,
  });
});
