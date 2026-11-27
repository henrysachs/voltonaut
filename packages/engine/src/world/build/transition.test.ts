import { expect, it } from "vitest";

import { assertSmoothCenterline } from "../curvature.js";

import { cumulativeLengths } from "./polyline.js";
import { transitionRoad, type RoadEnd } from "./transition.js";

const START: RoadEnd = { point: { x: 0, z: 0 }, headingRad: 0, elevationM: 10 };
const END: RoadEnd = { point: { x: 2000, z: 600 }, headingRad: 0.3, elevationM: 50 };

const road = transitionRoad(START, END, 10);

function chordHeading(index: number): number {
  const from = road.centerline[index];
  const to = road.centerline[index + 1];

  return Math.atan2((to?.z ?? 0) - (from?.z ?? 0), (to?.x ?? 0) - (from?.x ?? 0));
}

/** Lengths of all chords, in order. */
function chordLengths(): readonly number[] {
  const lengths = cumulativeLengths(road.centerline);

  return lengths.slice(1).map((lengthM, index) => lengthM - (lengths[index] ?? 0));
}

const elevations = road.profileSamples.map((sample) => sample.elevationM);

/** Elevation gained over the chord leaving a vertex. */
function rise(index: number): number {
  return (elevations[index + 1] ?? 0) - (elevations[index] ?? 0);
}

it("keeps both junction points and their elevations exactly", () => {
  expect(road.centerline[0]).toBe(START.point);
  expect(road.centerline.at(-1)).toBe(END.point);
  expect(road.profileSamples[0]).toStrictEqual({ distanceM: 0, elevationM: 10 });
  expect(road.profileSamples.at(-1)).toStrictEqual({ distanceM: road.lengthM, elevationM: 50 });
});

it("resamples to even chords of at most the chord length", () => {
  const chords = chordLengths();

  expect(road.lengthM).toBe(cumulativeLengths(road.centerline).at(-1));
  expect(Math.max(...chords)).toBeLessThanOrEqual(10.001);
  expect(Math.min(...chords)).toBeGreaterThan(9.9);
  expect(road.profileSamples).toHaveLength(road.centerline.length);
});

it("leaves and arrives along the junction headings without a kink", () => {
  expect(chordHeading(0)).toBeCloseTo(START.headingRad, 2);
  expect(chordHeading(road.centerline.length - 2)).toBeCloseTo(END.headingRad, 2);
  expect(() => {
    assertSmoothCenterline(road.centerline, false, "transition");
  }).not.toThrow();
});

it("eases the elevation: level at both ends and steepest in the middle", () => {
  const middle = Math.floor(elevations.length / 2);
  const rises = elevations.slice(1).map((_, index) => rise(index));

  expect(Math.min(...rises)).toBeGreaterThanOrEqual(0);
  expect(rise(0)).toBeLessThan(rise(middle) / 50);
  expect(rise(elevations.length - 2)).toBeLessThan(rise(middle) / 50);
  expect(elevations[middle]).toBeCloseTo(30, 0);
});

it("needs at least one chord for a short gap", () => {
  const short = transitionRoad(START, { ...START, point: { x: 4, z: 0 } }, 10);

  expect(short.centerline).toHaveLength(2);
  expect(short.lengthM).toBe(4);
});
