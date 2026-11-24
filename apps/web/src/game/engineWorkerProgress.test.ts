import { expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  RideProgressCheckpointSchema,
  type DeviceEvent,
} from "@voltonaut/shared";
import { riderParamsFromProfile } from "@voltonaut/engine";

import { bindEngineWorker, type EngineWorkerResponse } from "./engineWorkerCore.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const progressJournalId = "550e8400-e29b-41d4-a716-446655440000";

const trainerReading = {
  type: "trainer.data",
  tS: 0,
  powerW: 200,
  cadenceRpm: 90,
} satisfies DeviceEvent;

type EngineUpdate = Extract<EngineWorkerResponse, { readonly type: "engine.update" }>;

function requireLatestUpdate(posted: readonly EngineWorkerResponse[]): EngineUpdate {
  const update = posted.findLast((message) => message.type === "engine.update");

  if (update === undefined || update.type !== "engine.update") {
    throw new Error("Expected an engine update");
  }

  return update;
}

function actorUpdate(posted: readonly EngineWorkerResponse[], actorId: string): EngineUpdate {
  const update = posted.findLast(
    (message) => message.type === "engine.update" && message.actorId === actorId,
  );

  if (update === undefined || update.type !== "engine.update") {
    throw new Error(`Expected an engine update for ${actorId}`);
  }

  return update;
}

function idSequence(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    index += 1;

    if (id === undefined) throw new Error("Unexpected journal UUID request");

    return id;
  };
}

function setupProgressWorker({
  source = "sim",
}: {
  readonly source?: "sim" | "ble";
} = {}) {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(
    fake.scope,
    clock.nowMs,
    timers.schedule,
    timers.cancel,
    0,
    () => progressJournalId,
  );
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source,
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });

  return {
    ...fake,
    timers,
    latestUpdate: () => requireLatestUpdate(fake.posted),
    wake: (elapsedMs: number) => {
      clock.advanceMs(elapsedMs);
      timers.tick();

      return requireLatestUpdate(fake.posted);
    },
  };
}

it("leaves progress undefined on init and empty advances, then projects one native tick", () => {
  const run = setupProgressWorker();

  expect(run.latestUpdate().progress).toBeUndefined();
  run.timers.tick();
  run.wake(25);
  expect(run.latestUpdate().snapshot.tS).toBe(0);
  expect(run.latestUpdate().progress).toBeUndefined();

  run.send({ type: "engine.ingest", actorId: "actor", event: trainerReading });
  const update = run.wake(25);
  const progress = update.progress;

  expect(progress).toMatchObject({
    schemaVersion: 1,
    journalId: progressJournalId,
    sequence: 0,
    startTick: 0,
    endTick: 1,
    startedAtMs: 25,
    endedAtMs: 50,
    source: "sim",
    clockScale: 1,
    physicsRevision: "engine-v1",
    routeId: "flat-loop",
    routeRevision: "1",
    physics: riderParamsFromProfile(DEFAULT_RIDER_PROFILE),
    quality: { paused: false, dataAgeS: 0, clockSkipped: false },
  });
  expect(progress?.facts).toEqual([
    {
      powerW: 200,
      cadenceRpm: 90,
      timeS: 0.05,
      distanceM: update.snapshot.speedMps * 0.05,
      elevationGainM: 0,
      energyKj: 0.01,
    },
  ]);
  expect(RideProgressCheckpointSchema.safeParse(progress).success).toBe(true);
});

it("keeps progress ticks contiguous with one fact per native tick across wakes", () => {
  const run = setupProgressWorker();

  run.send({ type: "engine.ingest", actorId: "actor", event: trainerReading });
  run.timers.tick();
  const first = run.wake(50).progress;
  const second = run.wake(50).progress;
  const third = run.wake(50).progress;

  expect(first?.facts).toHaveLength(1);
  expect(second?.facts).toHaveLength(1);
  expect(third?.facts).toHaveLength(1);
  expect([
    [first?.sequence, first?.startTick, first?.endTick],
    [second?.sequence, second?.startTick, second?.endTick],
    [third?.sequence, third?.startTick, third?.endTick],
  ]).toEqual([
    [0, 0, 1],
    [1, 1, 2],
    [2, 2, 3],
  ]);
});

it("keeps HR in snapshots but out of progress checkpoint bytes", () => {
  const withHr = setupProgressWorker();
  const withoutHr = setupProgressWorker();

  for (const run of [withHr, withoutHr]) {
    run.send({ type: "engine.ingest", actorId: "actor", event: trainerReading });
    run.timers.tick();
  }

  withHr.send({
    type: "engine.ingest",
    actorId: "actor",
    event: { type: "hr.data", tS: 0, bpm: 140, rrMs: [800] },
  });
  const hrUpdate = withHr.wake(50);
  const noHrUpdate = withoutHr.wake(50);

  expect(hrUpdate.snapshot.hrBpm).toBe(140);
  expect(noHrUpdate.snapshot.hrBpm).toBeUndefined();
  expect(JSON.stringify(hrUpdate.progress)).toBe(JSON.stringify(noHrUpdate.progress));
  expect(JSON.stringify(hrUpdate.progress)).not.toContain("hrBpm");
  expect(JSON.stringify(hrUpdate.progress)).not.toContain("rrMs");
});

it("does not create extra progress or advances for recording commands", () => {
  const run = setupProgressWorker();

  run.send({ type: "engine.ingest", actorId: "actor", event: trainerReading });
  run.timers.tick();
  run.wake(50);
  expect(run.latestUpdate().progress).toMatchObject({ sequence: 0, endTick: 1 });

  run.send({
    type: "recording.command",
    actorId: "actor",
    requestId: 1,
    command: { kind: "start", rideId: progressJournalId },
  });
  expect(run.posted.filter((message) => message.type === "engine.update")).toHaveLength(2);

  run.wake(1000);
  expect(run.latestUpdate().progress).toMatchObject({ sequence: 1, startTick: 1, endTick: 21 });
  run.send({
    type: "recording.command",
    actorId: "actor",
    requestId: 2,
    command: { kind: "finish", rideId: progressJournalId },
  });
  expect(run.posted.filter((message) => message.type === "engine.update")).toHaveLength(3);

  const update = run.wake(50);

  expect(update.snapshot.tS).toBeCloseTo(1.1, 9);
  expect(update.progress).toMatchObject({ sequence: 2, startTick: 21, endTick: 22 });
});

it("marks a caught-up clock skip in quality without inventing extra facts", () => {
  const run = setupProgressWorker({ source: "ble" });

  run.timers.tick();
  const update = run.wake(7000);

  expect(update.events).toContainEqual({ type: "ride.clockSkipped", skippedS: 1 });
  expect(update.progress).toMatchObject({
    source: "ble",
    startTick: 0,
    endTick: 120,
    startedAtMs: 0,
    endedAtMs: 7000,
    quality: { paused: true, clockSkipped: true },
  });
  expect(update.progress?.facts).toHaveLength(120);
});

it("stops progress after dispose", () => {
  const run = setupProgressWorker();

  run.timers.tick();
  run.wake(50);
  expect(run.latestUpdate().progress).toMatchObject({ sequence: 0, endTick: 1 });

  run.send({ type: "engine.dispose", actorId: "actor" });
  run.wake(100);

  expect(run.timers.active()).toBe(0);
  expect(run.posted.filter((message) => message.type === "engine.update")).toHaveLength(2);
  expect(run.latestUpdate().progress).toMatchObject({ sequence: 0, endTick: 1 });
});

it("creates one injected journal UUID per engine session", () => {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();
  const firstId = "550e8400-e29b-41d4-a716-446655440000";
  const secondId = "550e8400-e29b-41d4-a716-446655440001";

  bindEngineWorker(
    fake.scope,
    clock.nowMs,
    timers.schedule,
    timers.cancel,
    0,
    idSequence([firstId, secondId]),
  );
  fake.send({
    type: "engine.init",
    actorId: "first",
    source: "sim",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();
  clock.advanceMs(50);
  timers.tick();

  fake.send({ type: "engine.dispose", actorId: "first" });
  fake.send({
    type: "engine.init",
    actorId: "second",
    source: "sim",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  timers.tick();
  clock.advanceMs(50);
  timers.tick();

  expect(actorUpdate(fake.posted, "first").progress?.journalId).toBe(firstId);
  expect(actorUpdate(fake.posted, "second").progress?.journalId).toBe(secondId);
});
