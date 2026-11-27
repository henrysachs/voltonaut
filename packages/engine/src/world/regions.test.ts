import { expect, it } from "vitest";

import { TEST_LOOP } from "../elevation/data/test-loop.js";

import { VOLTONAUT } from "./data/index.js";
import { edgeViews, regionViews } from "./regions.js";
import { singleRouteWorld } from "./singleRouteWorld.js";
import type { WorldData } from "./types.js";

const single = singleRouteWorld(TEST_LOOP, "1");

it("gives a single-route world one region whose home is the route", () => {
  expect(regionViews(single)).toEqual([
    { id: "test-loop", name: "Test Loop", scenery: "mixed", homePathId: "test-loop" },
  ]);
  expect(edgeViews(single)).toEqual([
    { id: "test-loop", regionId: "test-loop", scenery: "mixed", centerline: TEST_LOOP.centerline },
  ]);
});

it("homes every voltonaut region on its own loop, not on the tour", () => {
  expect(VOLTONAUT.regions.map((region) => [region.id, region.homePathId])).toEqual([
    ["forest", "voltonaut-forest"],
    ["coast", "voltonaut-coast"],
    ["night-city", "voltonaut-night-city"],
  ]);
  expect(VOLTONAUT.edges.map((edge) => edge.scenery)).toContain("coast");
  expect(VOLTONAUT.edges).toHaveLength(12);
});

it("leaves a region without its own path homeless and an unknown region without scenery", () => {
  const crossed: WorldData = {
    ...single,
    regions: [...single.regions, { id: "crossed", name: "Crossed", scenery: "coast" }],
  };

  const orphan: WorldData = {
    ...single,
    edges: single.edges.map((edge) => Object.assign({}, edge, { regionId: "nowhere" })),
  };

  expect(regionViews(crossed).at(-1)).toEqual({
    id: "crossed",
    name: "Crossed",
    scenery: "coast",
    homePathId: undefined,
  });
  expect(edgeViews(orphan)[0]?.scenery).toBe("");
});
