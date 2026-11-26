import { expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  RideProgressCheckpointSchema,
  type WorldPathReference,
} from "@voltonaut/shared";
import { riderParamsFromProfile } from "@voltonaut/engine";

import { startRecordedRide } from "./recordedRide.js";
import {
  createRideHarness,
  FIRST_RIDE_ID,
  SECOND_RIDE_ID,
  singleRouteWorldPath,
  TRAINER_READING,
} from "./testdata/recordedRideHarness.js";

const FLAT_LOOP_PATH = singleRouteWorldPath("flat-loop");

function progressRide(source: "sim" | "ble" = "sim") {
  return createRideHarness({ init: { source, worldPath: FLAT_LOOP_PATH } });
}

it("leaves progress undefined on init and empty advances, then projects one native tick", () => {
  const run = progressRide();

  expect(run.latest().progress).toBeUndefined();
  run.arm();
  expect(run.wake(25).snapshot.tS).toBe(0);
  expect(run.latest().progress).toBeUndefined();

  run.ingest(TRAINER_READING);
  const update = run.wake(25);
  const progress = update.progress;

  expect(progress).toMatchObject({
    schemaVersion: 1,
    journalId: FIRST_RIDE_ID,
    sequence: 0,
    startTick: 0,
    endTick: 1,
    startedAtMs: 25,
    endedAtMs: 50,
    source: "sim",
    clockScale: 1,
    physicsRevision: "engine-v1",
    worldId: "flat-loop",
    worldRevision: "1",
    pathId: "flat-loop",
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

it("runs one 0.05 s virtual tick per 50 ms real wake with contiguous progress", () => {
  const run = progressRide();

  run.ingest(TRAINER_READING);
  run.arm();
  const updates = [run.wake(50), run.wake(50), run.wake(50)];

  expect(updates[0]?.snapshot.tS).toBeCloseTo(0.05, 10);
  expect(updates[2]?.snapshot.tS).toBeCloseTo(0.15, 10);
  expect(updates.map((update) => update.progress?.facts.length)).toEqual([1, 1, 1]);
  expect(
    updates.map(({ progress }) => [progress?.sequence, progress?.startTick, progress?.endTick]),
  ).toEqual([
    [0, 0, 1],
    [1, 1, 2],
    [2, 2, 3],
  ]);
  expect(updates[0]?.snapshot.powerW).toBeGreaterThan(0);
});

it("scales virtual time with the fast test clock", () => {
  const run = createRideHarness({ init: { worldPath: FLAT_LOOP_PATH, clockScale: 20 } });

  run.arm();

  // 50 ms real x 20 => 1 s virtual => 20 ticks of 0.05 s.
  const update = run.wake(50);

  expect(update.snapshot.tS).toBeCloseTo(1, 9);
  expect(update.progress).toMatchObject({ clockScale: 20, startTick: 0, endTick: 20 });
  expect(update.progress?.facts).toHaveLength(20);
});

it("keeps HR in snapshots but out of progress checkpoint bytes", () => {
  const withHr = progressRide();
  const withoutHr = progressRide();

  for (const run of [withHr, withoutHr]) {
    run.ingest(TRAINER_READING);
    run.arm();
  }

  withHr.ingest({ type: "hr.data", tS: 0, bpm: 140, rrMs: [800] });
  const hrUpdate = withHr.wake(50);
  const noHrUpdate = withoutHr.wake(50);

  expect(hrUpdate.snapshot.hrBpm).toBe(140);
  expect(noHrUpdate.snapshot.hrBpm).toBeUndefined();
  expect(JSON.stringify(hrUpdate.progress)).toBe(JSON.stringify(noHrUpdate.progress));
  expect(JSON.stringify(hrUpdate.progress)).not.toContain("hrBpm");
  expect(JSON.stringify(hrUpdate.progress)).not.toContain("rrMs");
});

it("does not create extra progress or advances for recording commands", () => {
  const run = progressRide();

  run.ingest(TRAINER_READING);
  run.arm();
  expect(run.wake(50).progress).toMatchObject({ sequence: 0, endTick: 1 });

  run.capture("start");
  expect(run.wake(1000).progress).toMatchObject({ sequence: 1, startTick: 1, endTick: 21 });
  run.capture("finish");

  const update = run.wake(50);

  expect(run.updates).toHaveLength(4);
  expect(update.snapshot.tS).toBeCloseTo(1.1, 9);
  expect(update.progress).toMatchObject({ sequence: 2, startTick: 21, endTick: 22 });
});

it("marks a caught-up clock skip in quality without inventing extra facts", () => {
  const run = progressRide("ble");

  run.arm();
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

it("stops progress after stop", () => {
  const run = progressRide();

  run.arm();
  expect(run.wake(50).progress).toMatchObject({ sequence: 0, endTick: 1 });
  run.ride.stop();

  expect(run.ride.wake(run.nowMs() + 100)).toBeUndefined();
  expect(run.ride.closed(run.nowMs())).toBe(true);
});

it("asks for one journal UUID per ride, at its start", () => {
  const requested: string[] = [];

  const journalIds = [FIRST_RIDE_ID, SECOND_RIDE_ID].map((id) => {
    const run = createRideHarness({
      init: { worldPath: FLAT_LOOP_PATH },
      newId: () => {
        requested.push(id);

        return id;
      },
    });

    run.arm();

    return run.wake(50).progress?.journalId;
  });

  expect(requested).toEqual([FIRST_RIDE_ID, SECOND_RIDE_ID]);
  expect(journalIds).toEqual([FIRST_RIDE_ID, SECOND_RIDE_ID]);
});

it.each([
  {
    worldPath: singleRouteWorldPath("does-not-exist"),
    clockScale: 1,
    message: "unknown world path: World does-not-exist, revision 1, path does-not-exist",
  },
  {
    worldPath: { ...FLAT_LOOP_PATH, worldRevision: "2" },
    clockScale: 1,
    message: "unknown world path: World flat-loop, revision 2, path flat-loop",
  },
  {
    worldPath: { ...FLAT_LOOP_PATH, pathId: "test-loop" },
    clockScale: 1,
    message: "unknown world path: World flat-loop, revision 1, path test-loop",
  },
  { worldPath: FLAT_LOOP_PATH, clockScale: 21, message: "Invalid engine clock scale" },
  { worldPath: FLAT_LOOP_PATH, clockScale: Number.NaN, message: "Invalid engine clock scale" },
])(
  "refuses to start on $worldPath at clock scale $clockScale",
  ({
    worldPath,
    clockScale,
    message,
  }: {
    readonly worldPath: WorldPathReference;
    readonly clockScale: number;
    readonly message: string;
  }) => {
    expect(() =>
      startRecordedRide(
        { source: "sim", worldPath, profile: DEFAULT_RIDER_PROFILE, clockScale },
        0,
        0,
        () => FIRST_RIDE_ID,
      ),
    ).toThrow(message);
  },
);
