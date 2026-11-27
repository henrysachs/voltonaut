import { expect, it } from "vitest";

import {
  chordHeadingRad,
  cumulativeLengths,
  cutPiece,
  elevationAt,
  vertexFacing,
  type SourceRoad,
} from "./polyline.js";

/** Closed square-ish loop of four 10 m chords with a rising then falling profile. */
const SQUARE: SourceRoad = {
  closed: true,
  centerline: [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
    { x: 0, z: 0 },
  ],
  profileSamples: [
    { distanceM: 0, elevationM: 0 },
    { distanceM: 15, elevationM: 15 },
    { distanceM: 25, elevationM: 5 },
    { distanceM: 40, elevationM: 0 },
  ],
};

const LINE: SourceRoad = {
  closed: false,
  centerline: [
    { x: 0, z: 0 },
    { x: 3, z: 4 },
    { x: 6, z: 8 },
  ],
  profileSamples: [
    { distanceM: 0, elevationM: 10 },
    { distanceM: 10, elevationM: 20 },
  ],
};

it("sums chord lengths in order", () => {
  expect(cumulativeLengths(LINE.centerline)).toEqual([0, 5, 10]);
  expect(cumulativeLengths([{ x: 1, z: 1 }])).toEqual([0]);
});

it("interpolates the profile linearly and holds a single sample", () => {
  expect(elevationAt(SQUARE.profileSamples, 7.5)).toBe(7.5);
  expect(elevationAt(SQUARE.profileSamples, 20)).toBe(10);
  expect(elevationAt(SQUARE.profileSamples, 40)).toBe(0);
  expect(elevationAt([{ distanceM: 0, elevationM: 3 }], 0)).toBe(3);
  expect(() => elevationAt([], 0)).toThrow("profile samples are missing");
});

it("cuts an open road with interpolated ends at its own chord length", () => {
  expect(cutPiece(LINE, 1, 2)).toStrictEqual({
    centerline: [
      { x: 3, z: 4 },
      { x: 6, z: 8 },
    ],
    lengthM: 5,
    profileSamples: [
      { distanceM: 0, elevationM: 15 },
      { distanceM: 5, elevationM: 20 },
    ],
  });
});

it("cuts a closed road across its seam without a duplicate seam sample", () => {
  const piece = cutPiece(SQUARE, 3, 5);

  expect(piece.centerline).toStrictEqual([
    { x: 0, z: 10 },
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ]);
  expect(piece.lengthM).toBe(20);
  expect(piece.profileSamples).toStrictEqual([
    { distanceM: 0, elevationM: 10 / 3 },
    { distanceM: 10, elevationM: 0 },
    { distanceM: 20, elevationM: 10 },
  ]);
});

it("keeps inner samples strictly inside the cut", () => {
  const piece = cutPiece(SQUARE, 1, 3);

  expect(piece.profileSamples.map((sample) => sample.distanceM)).toEqual([0, 5, 15, 20]);
  expect(piece.profileSamples.map((sample) => sample.elevationM)).toEqual([10, 15, 5, 10 / 3]);
});

it.each([
  [SQUARE, 2, 2],
  [SQUARE, 3, 1],
  [SQUARE, 0, 5],
  [LINE, 1, 3],
])("rejects the cut from %# vertex %i to %i", (road, from, to) => {
  expect(() => cutPiece(road, from, to)).toThrow(`cannot cut road from vertex ${from} to ${to}`);
});

it("reports chord headings and finds the vertex facing a heading", () => {
  expect(chordHeadingRad(SQUARE.centerline, 1)).toBe(Math.PI / 2);
  expect(() => chordHeadingRad(SQUARE.centerline, 4)).toThrow("no chord leaves vertex 4");
  expect(vertexFacing(SQUARE.centerline, 0)).toBe(0);
  expect(vertexFacing(SQUARE.centerline, Math.PI / 2 - 0.1)).toBe(1);
  expect(vertexFacing(SQUARE.centerline, -Math.PI)).toBe(2);
  expect(vertexFacing(SQUARE.centerline, -Math.PI / 2 + 2 * Math.PI)).toBe(3);
});
