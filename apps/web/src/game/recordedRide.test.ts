import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import {
  createRideHarness,
  FIRST_RIDE_ID,
  journalCapture,
  SECOND_RIDE_ID,
  TRAINER_READING,
} from "./testdata/recordedRideHarness.js";

/** Init at 0 ms, one trainer reading, then the arming wake. */
function armedRide(options: Parameters<typeof createRideHarness>[0] = {}) {
  const run = createRideHarness(options);
  run.ingest({ ...TRAINER_READING, tS: 999 });
  run.arm();

  return run;
}

it("captures the committed state without advancing or arming on recording commands", () => {
  const run = createRideHarness({
    startMs: 100,
    timeOriginMs: Date.parse("2026-11-20T00:00:00.000Z"),
  });

  run.ingest({ ...TRAINER_READING, tS: 999 });
  run.capture("start");
  run.elapse(1000);
  run.arm();
  expect(run.capture("finish")).toMatchObject({
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
  });
  expect(run.wake(50).snapshot.tS).toBeCloseTo(0.05, 10);
  expect(JSON.stringify(run.latest())).not.toContain('"entries"');
});

it("rejects duplicate and late ride commands without overwriting completion", () => {
  const run = armedRide();
  run.capture("start");
  run.wake(1000);
  expect(run.captureAs(2, { kind: "finish", rideId: FIRST_RIDE_ID }).kind).toBe("finished");
  expect(run.captureAs(2, { kind: "finish", rideId: FIRST_RIDE_ID }).kind).toBe("failed");
  expect(run.capture("start", SECOND_RIDE_ID).kind).toBe("failed");
  expect(run.capture("release", SECOND_RIDE_ID).kind).toBe("failed");
  expect(run.capture("release")).toMatchObject({ kind: "state", view: { kind: "idle" } });
  run.capture("start", SECOND_RIDE_ID);
  expect(run.capture("finish")).toMatchObject({
    kind: "failed",
    view: { rideId: SECOND_RIDE_ID },
  });
  expect(run.captureAs(Number.NaN, { kind: "discard", rideId: SECOND_RIDE_ID }).kind).toBe(
    "failed",
  );
  expect(run.wake(50).snapshot.tS).toBeCloseTo(1.05, 10);
  expect(run.latest().recording).toMatchObject({ kind: "recording", rideId: SECOND_RIDE_ID });
});

it("preserves same-clock actor order and samples the committed state without an extra advance", () => {
  const run = armedRide();
  run.elapse(25);
  run.capture("start");
  run.ingest({
    type: "controller.button",
    tS: -999,
    button: "shiftUp",
    pressed: true,
    source: "test",
  });
  run.wake(50);
  run.elapse(950);
  expect(run.capture("finish")).toMatchObject({
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
  });
  expect(run.updates).toHaveLength(2);
});

it("stops wakes and inputs but retains an unsecured completion until matching release", () => {
  const run = armedRide();
  run.capture("start");
  run.wake(1000);
  run.capture("finish");
  run.ride.stop();
  expect(run.ride.wake(run.nowMs() + 50)).toBeUndefined();
  expect(run.ride.closed(run.nowMs())).toBe(false);
  expect(run.capture("release", SECOND_RIDE_ID)).toMatchObject({
    kind: "failed",
    view: { kind: "completed", rideId: FIRST_RIDE_ID },
  });
  expect(run.capture("release").kind).toBe("state");
  expect(run.ride.closed(run.nowMs())).toBe(true);
  expect(run.capture("start", SECOND_RIDE_ID).kind).toBe("failed");
});

it("freezes initialization metadata independently of later caller profile edits", () => {
  const profile = { ...DEFAULT_RIDER_PROFILE, bike: { ...DEFAULT_RIDER_PROFILE.bike } };
  const run = createRideHarness({ init: { profile } });
  profile.massKg = 140;
  profile.bike.massKg = 20;
  run.ingest(TRAINER_READING);
  run.capture("start");
  run.arm();
  run.wake(1000);
  expect(run.capture("finish")).toMatchObject({
    kind: "finished",
    capture: {
      kind: "journal",
      recording: {
        rideId: FIRST_RIDE_ID,
        initialization: {
          profile: DEFAULT_RIDER_PROFILE,
          source: "sim",
          worldId: "test-loop",
          worldRevision: "1",
          pathId: "test-loop",
          clockScale: 1,
        },
      },
    },
  });
});

it("delivers the same real engine outputs to the update and journal without a second drain", () => {
  const run = armedRide();
  run.capture("start");
  const update = run.wake(1000);
  const observations = journalCapture(run.capture("finish")).recording.observations;

  expect(update.commands.length).toBeGreaterThan(0);
  expect(observations.flatMap((observation) => observation.commands)).toEqual(update.commands);
  expect(observations.flatMap((observation) => observation.events)).toEqual(update.events);
});
