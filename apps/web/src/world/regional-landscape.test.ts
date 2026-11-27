import { expect, it } from "vitest";

import { dominantRegion } from "./region-map.js";
import { PAIR } from "./testdata/pairWorld.js";
import { planWorldLandscape } from "./world-landscape.js";

const { landscape, regionMap } = planWorldLandscape(PAIR);

it("plans one raster for the world and one plan per region on its home path", () => {
  expect(landscape.plans.map((plan) => plan.route.id)).toEqual(["pair-woods", "pair-city"]);
  expect(landscape.plans.every((plan) => plan.terrain === landscape.terrain)).toBe(true);
  expect(landscape.lakes).toHaveLength(2);
  expect(landscape.plans.map((plan) => plan.lake)).toEqual(landscape.lakes);
});

it("carves a lake only for the region whose biome has one", () => {
  expect(landscape.lakes.map((lake) => lake.alongRadiusM)).toEqual([148, 1]);
});

/** Regions the map names at the plants of one plan. */
function owners(planIndex: number, kind: "trees" | "rocks"): ReadonlySet<number> {
  const plants = landscape.plans[planIndex]?.[kind] ?? [];

  return new Set(
    plants.map((plant) => dominantRegion(regionMap, plant.position.x, plant.position.z)),
  );
}

function treeCount(planIndex: number): number {
  return landscape.plans[planIndex]?.trees.length ?? 0;
}

it("gives every plant to the region the map names at its position", () => {
  expect(treeCount(0)).toBeGreaterThan(100);
  expect(treeCount(1)).toBeGreaterThan(100);
  expect(owners(0, "trees")).toEqual(new Set([0]));
  expect(owners(1, "trees")).toEqual(new Set([1]));
  expect(owners(1, "rocks")).toEqual(new Set([1]));
});

it("keeps no apron outside the alpine biome", () => {
  expect(landscape.plans.map((plan) => plan.apron)).toEqual([[], []]);
});
