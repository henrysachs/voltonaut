import { expect, it } from "vitest";
import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  type RecordingV2,
  type ReplayObservationV2,
} from "@voltonaut/shared";

import { assessRecordingV2 } from "./replay.js";
import {
  replayEngine as engine,
  recordReplay as record,
  normalReplay as normal,
  replayed,
  windowFailures,
} from "../testing/replay.spec.js";

it("proves a pose cannot preserve hidden fractional accumulator state", () => {
  const warm = engine();
  warm.advance(0.025);
  const pose = warm.snapshot();

  const cold = createEngine({
    route: createRoute(TEST_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
    initialGearIndex: pose.gear.index,
    initialSpeedMps: pose.speedMps,
    initialRoutePosM: pose.routePosM,
  });

  expect(cold.snapshot()).toEqual(pose);

  for (const instance of [warm, cold]) {
    instance.ingest({ type: "trainer.data", tS: 0, powerW: 250, cadenceRpm: 90 });
    instance.advance(0.025);
  }

  expect(warm.snapshot().distanceM).toBeGreaterThan(0);
  expect(cold.snapshot().distanceM).toBe(0);
  expect(warm.snapshot().tS).toBe(0.05);
  expect(cold.snapshot().tS).toBe(0);
});

it("proves a stationary pose does not reconstruct the hidden pause timer", () => {
  const warm = engine();
  warm.advance(5);
  const pose = warm.snapshot();

  const cold = createEngine({
    route: createRoute(TEST_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
    initialRoutePosM: pose.routePosM,
    initialSpeedMps: pose.speedMps,
    initialGearIndex: pose.gear.index,
  });

  expect(pose.routePosM).toBe(cold.snapshot().routePosM);
  expect(pose.speedMps).toBe(cold.snapshot().speedMps);
  expect(pose.paused).toBe(false);
  warm.advance(0.05);
  cold.advance(0.05);
  expect(warm.snapshot().paused).toBe(true);
  expect(cold.snapshot().paused).toBe(false);
});

it("reproduces complete fractional history, partial inputs, shifts and outputs", () => {
  const ride = record([
    [0, 0, "arm"],
    [1, 25, "advance", 0.025],
    [2, 25, "trainer", 250, 90, null],
    [3, 25, "boundary", "start"],
    [4, 25, "trainer", null, 80, null],
    [5, 25, "trainer", 0, null, null],
    [6, 25, "hr", 130],
    [7, 25, "shift", "shiftUp"],
    [8, 25, "shift", "shiftDown"],
    [9, 50, "advance", 0.025],
    [10, 50, "trainer", 300, null, null],
    [11, 1025, "advance", 0.975],
    [12, 1025, "boundary", "finish"],
  ]);

  const result = replayed(ride);
  expect(result.summary.distanceM).toBe(ride.observations.at(-1)?.snapshot.distanceM);
  expect(result.summary.energyKj).toBeGreaterThan(0);
  expect(result.source.window.kind).toBe("blocked");
});

it("replays a complete recording on a newly selectable biome route", () => {
  const ride = record(
    [
      [0, 0, "arm"],
      [1, 0, "boundary", "start"],
      [2, 0, "trainer", 250, 90, null],
      [3, 1000, "advance", 1],
      [4, 1000, "boundary", "finish"],
    ],
    1,
    "coast-loop",
  );

  expect(assessRecordingV2(ride).status).toBe("replayed");
});

it("arms first wake without inventing physics time and excludes warmup from window", () => {
  const ride = record([
    [0, 50, "arm"],
    [1, 50, "trainer", 250, 90, null],
    [2, 1050, "advance", 1],
    [3, 1050, "boundary", "start"],
    [4, 1050, "trainer", 250, 90, null],
    [5, 2050, "advance", 1],
    [6, 2050, "boundary", "finish"],
  ]);

  const result = replayed(ride);
  const start = ride.observations[0];
  const finish = ride.observations[1];
  expect(result.summary.distanceM).toBe(
    Number(finish?.snapshot.distanceM) - Number(start?.snapshot.distanceM),
  );
  expect(result.summary.energyKj).toBeCloseTo(0.25, 12);
  expect(result.summary.tS).toBeCloseTo(1, 12);
  expect(result.summary.eventCount).toBe(20);
});

it.each([2.5, 3, 3.05, 5, 6, 6.05, 121 * 0.05, 12])(
  "replays exact freshness/catchup duration %s",
  (durationS) => {
    const ride = record([
      [0, 0, "arm"],
      [1, 0, "boundary", "start"],
      [2, 0, "trainer", 250, 90, null],
      [3, durationS * 1000, "advance", durationS],
      [4, durationS * 1000, "boundary", "finish"],
    ]);

    expect(assessRecordingV2(ride).status).toBe("replayed");
    const finish = ride.observations.at(-1);
    expect(finish?.events.some((event) => event.type === "ride.clockSkipped")).toBe(
      Math.floor(durationS / 0.05) > 120,
    );
  },
);

it("does not clear held engine inputs on a disconnect marker; reports ineligibility", () => {
  const ride = record([
    [0, 0, "arm"],
    [1, 0, "boundary", "start"],
    [2, 0, "trainer", 250, 90, null],
    [3, 500, "advance", 0.5],
    [4, 500, "status", "trainer", "disconnected"],
    [5, 1000, "advance", 0.5],
    [6, 1000, "boundary", "finish"],
  ]);

  const result = replayed(ride);
  expect(result.summary.energyKj).toBeCloseTo(0.25, 12);
  expect(windowFailures(ride)).toContain("trainer_disconnect");
});

it("keeps V2 incomplete and unknown revisions unverified", () => {
  const ride = normal();
  expect(assessRecordingV2({ ...ride, journalState: "incomplete" })).toEqual({
    status: "unverified",
    reason: "incomplete_journal",
  });

  for (const initialization of [
    { ...ride.initialization, physicsRevision: "future" },
    { ...ride.initialization, routeRevision: "future" },
    { ...ride.initialization, routeId: "missing-route" },
  ]) {
    expect(assessRecordingV2({ ...ride, initialization })).toEqual({
      status: "unverified",
      reason: "unknown_revision",
    });
  }
});

it("rejects distance, discrete state, profile and scale tampering", () => {
  const ride = normal();

  for (const patch of [
    { distanceM: 1 },
    { paused: true },
    { gearIndex: 12 },
    { tS: 1.00000000001 },
  ]) {
    const observations = patchFinish(ride, patch);
    expect(assessRecordingV2({ ...ride, observations }).status).toBe("rejected");
  }

  expect(
    assessRecordingV2({ ...ride, initialization: { ...ride.initialization, clockScale: 20 } })
      .status,
  ).toBe("rejected");
  expect(
    assessRecordingV2({
      ...ride,
      initialization: {
        ...ride.initialization,
        profile: { ...ride.initialization.profile, massKg: 90 },
      },
    }).status,
  ).toBe("rejected");
  expect(assessRecordingV2({ ...ride, entries: ride.entries.slice(1) }).status).toBe("rejected");
  expect(assessRecordingV2({ ...ride, entries: ride.entries.toReversed() }).status).toBe(
    "rejected",
  );
});

it("uses narrow float tolerance but never a three-percent distance allowance", () => {
  const ride = normal();

  const perturb = (deltaM: number) => ({
    ...ride,
    observations: patchFinish(ride, {
      distanceM: Number(ride.observations.at(-1)?.snapshot.distanceM) + deltaM,
    }),
  });

  expect(assessRecordingV2(perturb(0.0000005)).status).toBe("replayed");
  expect(assessRecordingV2(perturb(0.000002)).status).toBe("rejected");
});

it("replays scale 20 simulation without making it export eligible", () => {
  const ride = record(
    [
      [0, 0, "arm"],
      [1, 0, "boundary", "start"],
      [2, 0, "trainer", 250, 90, null],
      [3, 1000, "advance", 1],
      [4, 1000, "boundary", "finish"],
    ],
    20,
  );

  const result = replayed({ ...ride, initialization: { ...ride.initialization, source: "sim" } });
  expect(result.source.window.kind).toBe("blocked");
  expect(
    windowFailures({ ...ride, initialization: { ...ride.initialization, source: "sim" } }),
  ).toEqual(expect.arrayContaining(["sim", "clock_scale", "clock_skipped"]));
});

function patchFinish(
  ride: RecordingV2,
  patch: Partial<ReplayObservationV2["snapshot"]>,
): readonly ReplayObservationV2[] {
  return ride.observations.map((observation, index) => {
    if (index !== ride.observations.length - 1) return observation;

    return { ...observation, snapshot: { ...observation.snapshot, ...patch } };
  });
}
