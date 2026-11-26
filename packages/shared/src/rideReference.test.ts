import { expect, it } from "vitest";

import { RecordingV2Schema } from "./recordingV2.js";
import { projectRecordingTrack } from "./recordingTrack.js";
import {
  describeRideReference,
  isWorldPathReference,
  rideReferenceOf,
  sameRideReference,
  type LegacyRouteReference,
  type WorldPathReference,
} from "./rideReference.js";
import { serializeRideTcx } from "./rideTcx.js";
import { recordedRide } from "./testdata/recording.js";

const WORLD: WorldPathReference = { worldId: "test-loop", worldRevision: "1", pathId: "test-loop" };
const ROUTE: LegacyRouteReference = { routeId: "test-loop", routeRevision: "1" };

const recording = recordedRide();

const worldRecording = RecordingV2Schema.parse({
  ...recording,
  initialization: {
    physicsRevision: recording.initialization.physicsRevision,
    ...WORLD,
    profile: recording.initialization.profile,
    source: recording.initialization.source,
    clockScale: recording.initialization.clockScale,
    workerTimeOriginMs: recording.initialization.workerTimeOriginMs,
    initializedWorkerMs: recording.initialization.initializedWorkerMs,
  },
});

it("projects the world path of a recording into its track and TCX notes", () => {
  const track = projectRecordingTrack(worldRecording);

  expect(rideReferenceOf(track.metadata)).toEqual(WORLD);
  expect(serializeRideTcx(track)).toContain(
    "Calories 0 means unavailable. World test-loop, revision 1, path test-loop. Ride ",
  );
});

it("keeps the stored route wording in TCX notes of single-route tracks", () => {
  const track = projectRecordingTrack(recording);

  expect(rideReferenceOf(track.metadata)).toEqual(ROUTE);
  expect(serializeRideTcx(track)).toContain(
    "Calories 0 means unavailable. Route test-loop, revision 1. Ride ",
  );
});

it("copies only reference fields and tells both forms apart", () => {
  const worldRide = { ...WORLD, source: "ble" };
  const routeRide = { ...ROUTE, source: "ble" };

  expect(rideReferenceOf(worldRide)).toStrictEqual(WORLD);
  expect(rideReferenceOf(routeRide)).toStrictEqual(ROUTE);
  expect(isWorldPathReference(WORLD)).toBe(true);
  expect(isWorldPathReference(ROUTE)).toBe(false);
  expect(describeRideReference(WORLD)).toBe("World test-loop, revision 1, path test-loop");
  expect(describeRideReference(ROUTE)).toBe("Route test-loop, revision 1");
});

it.each([
  [WORLD, WORLD, true],
  [ROUTE, ROUTE, true],
  [WORLD, ROUTE, false],
  [ROUTE, WORLD, false],
  [WORLD, { ...WORLD, worldId: "flat-loop" }, false],
  [WORLD, { ...WORLD, worldRevision: "2" }, false],
  [WORLD, { ...WORLD, pathId: "other" }, false],
  [ROUTE, { ...ROUTE, routeId: "flat-loop" }, false],
  [ROUTE, { ...ROUTE, routeRevision: "2" }, false],
])("compares %o with %o as %s", (left, right, same) => {
  expect(sameRideReference(left, right)).toBe(same);
});
