import { expect, it } from "vitest";

import { createRegionMap, dominantRegion, REGION_BLEND_M, type RegionRoad } from "./region-map.js";

/** Two straight regions meeting at x = 0, plus a far third one. */
const ROADS: readonly RegionRoad[] = [
  {
    regionId: "west",
    centerline: Array.from({ length: 101 }, (_, i) => ({ x: -1000 + i * 10, z: 0 })),
  },
  { regionId: "east", centerline: Array.from({ length: 101 }, (_, i) => ({ x: i * 10, z: 0 })) },
  {
    regionId: "far",
    centerline: [
      { x: 0, z: 9000 },
      { x: 10, z: 9000 },
    ],
  },
];

const map = createRegionMap(ROADS, ["west", "east", "far"]);

function sum(weights: readonly number[]): number {
  return weights.reduce((total, weight) => total + weight, 0);
}

it("weighs a one-region world fully to its region everywhere", () => {
  const single = createRegionMap(ROADS.slice(0, 1), ["west"]);

  expect(single.regionIds).toEqual(["west"]);
  expect(single.weightsAt(123_456, -7)).toEqual([1]);
});

it("keeps a region alone deep inside its own roads", () => {
  expect(map.regionIds).toEqual(["west", "east", "far"]);
  expect(map.weightsAt(-900, 5)).toEqual([1, 0, 0]);
  expect(map.weightsAt(900, 5)).toEqual([0, 1, 0]);
});

it("blends two regions across their border with weights that sum to 1", () => {
  const border = map.weightsAt(0, 40);
  const westish = map.weightsAt(-200, 40);

  expect(sum(border)).toBeCloseTo(1, 12);
  expect(border[0]).toBeGreaterThan(0.3);
  expect(border[1]).toBeGreaterThan(0.3);
  const [west, east] = westish;

  expect(west).toBeGreaterThan(Number(east));
  expect(east).toBeGreaterThan(0);
});

it("gives a point beyond every blend zone to the nearest region alone", () => {
  expect(map.weightsAt(5, 9000 - REGION_BLEND_M - 200)).toEqual([0, 0, 1]);
  expect(map.weightsAt(-500, -REGION_BLEND_M - 300)).toEqual([1, 0, 0]);
  expect(map.weightsAt(500, -REGION_BLEND_M - 300)).toEqual([0, 1, 0]);
});

it("reuses weights within a 64 m square", () => {
  expect(map.weightsAt(-300, 1)).toBe(map.weightsAt(-260, 60));
  expect(map.weightsAt(-300, 1)).not.toBe(map.weightsAt(-300, 70));
});

it("finds the truly nearest far region, not the first one a widening ring touches", () => {
  const roads: readonly RegionRoad[] = [
    // Corner of ring 14, about 4180 m away.
    { regionId: "a", centerline: [{ x: 2990, z: 2990 }] },
    // Side of ring 15, about 2980 m away.
    { regionId: "b", centerline: [{ x: 32, z: 3010 }] },
  ];

  const far = createRegionMap(roads, ["a", "b"]);

  expect(far.weightsAt(32, 32)).toEqual([0, 1]);
});

it("names the region with the largest weight, the earlier one on a tie", () => {
  expect(dominantRegion(map, -400, 10)).toBe(0);
  expect(dominantRegion(map, 400, 10)).toBe(1);
  expect(dominantRegion({ regionIds: ["a", "b"], weightsAt: () => [0.5, 0.5] }, 0, 0)).toBe(0);
});
