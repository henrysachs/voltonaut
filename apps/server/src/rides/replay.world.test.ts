import { expect, it } from "vitest";
import {
  RideAssessmentSchema,
  WORLD_PATH_REPLAY_REVISION,
  type RecordingEntryV2,
  type RecordingV2,
  type RideReference,
} from "@voltonaut/shared";

import { assessRecordingV2 } from "./replay.js";
import {
  normalReplay,
  recordReplay,
  replayed,
  TEST_LOOP_ROUTE,
  TEST_LOOP_WORLD_PATH,
} from "../testing/replay.spec.js";

const SEGMENT_RIDE: readonly RecordingEntryV2[] = [
  [0, 0, "arm"],
  [1, 0, "status", "trainer", "ready"],
  [2, 0, "trainer", 400, 95, null],
  [3, 0, "boundary", "start"],
  [4, 30_000, "advance", 30],
  [5, 30_000, "trainer", 380, 92, null],
  [6, 60_000, "advance", 30],
  [7, 60_000, "boundary", "finish"],
];

it("replays a world path ride with the explicit world path replay revision", () => {
  const result = replayed(normalReplay(TEST_LOOP_WORLD_PATH));

  expect(WORLD_PATH_REPLAY_REVISION).toBe("world-path-1");
  expect(Object.keys(result)).toEqual([
    "status",
    "physicsRevision",
    "replayRevision",
    "summary",
    "source",
  ]);
  expect(result).toMatchObject({ physicsRevision: "engine-v1", replayRevision: "world-path-1" });
  expect(RideAssessmentSchema.parse(result)).toEqual(result);
});

it("keeps the stored single-route assessment form without a replay revision", () => {
  const result = replayed(normalReplay(TEST_LOOP_ROUTE));

  expect(Object.keys(result)).toEqual(["status", "physicsRevision", "summary", "source"]);
  expect(RideAssessmentSchema.parse(result)).toEqual(result);
});

it("recomputes the same window from the same journal as world path and as route", () => {
  const world = replayed(recordReplay(SEGMENT_RIDE, 1, TEST_LOOP_WORLD_PATH));
  const route = replayed(recordReplay(SEGMENT_RIDE, 1, TEST_LOOP_ROUTE));

  expect(world.summary.distanceM).toBeGreaterThan(50);
  expect(world.summary.eventCount).toBeGreaterThan(0);
  expect(world.summary).toEqual(route.summary);
  expect(world.source).toEqual(route.source);
});

it.each<RideReference>([
  { ...TEST_LOOP_WORLD_PATH, worldId: "missing-world", pathId: "missing-world" },
  { ...TEST_LOOP_WORLD_PATH, worldId: "voltonaut" },
  { ...TEST_LOOP_WORLD_PATH, worldRevision: "2" },
  { ...TEST_LOOP_WORLD_PATH, pathId: "flat-loop" },
  { ...TEST_LOOP_WORLD_PATH, pathId: "coast-loop" },
  { ...TEST_LOOP_ROUTE, routeId: "missing-route" },
  { ...TEST_LOOP_ROUTE, routeRevision: "2" },
])("keeps %o unverified as an unknown revision", (reference) => {
  expect(assessRecordingV2(normalReplay(reference))).toEqual({
    status: "unverified",
    reason: "unknown_revision",
  });
});

/** The same recording with a different claimed finish distance. */
function withFinishDistance(ride: RecordingV2, distanceM: number): RecordingV2 {
  const finish = ride.observations.at(-1);

  if (finish === undefined) throw new Error("test: recording without finish observation");

  return {
    ...ride,
    observations: [
      ...ride.observations.slice(0, -1),
      { ...finish, snapshot: { ...finish.snapshot, distanceM } },
    ],
  };
}

it("rejects a world path ride whose observation differs from the recomputation", () => {
  expect(assessRecordingV2(withFinishDistance(normalReplay(TEST_LOOP_WORLD_PATH), 50))).toEqual({
    status: "rejected",
    reason: "observation_mismatch",
  });
});

it("rejects a recording that names a world path and a route at once", () => {
  const ride = normalReplay(TEST_LOOP_WORLD_PATH);

  expect(
    assessRecordingV2({ ...ride, initialization: { ...ride.initialization, ...TEST_LOOP_ROUTE } }),
  ).toEqual({ status: "rejected", reason: "invalid_contract" });
});
