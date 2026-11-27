import { createWorld, singleRouteWorld, TEST_LOOP } from "@voltonaut/engine";
import { expect, it } from "vitest";

import { renderWorldOf, resolveRenderWorld } from "./render-world.js";

it("draws a single-route world as one region dressed along its route", () => {
  const world = resolveRenderWorld("coast-loop");

  expect(world.roads.map((road) => road.id)).toEqual(["coast-loop"]);
  expect(world.regions.map((region) => [region.id, region.biome.kind, region.home.id])).toEqual([
    ["coast-loop", "coast", "coast-loop"],
  ]);
  expect(world.regionRoads.map((road) => road.regionId)).toEqual(["coast-loop"]);
  expect(world.sideRoads("coast-loop")).toEqual([]);
});

it("draws voltonaut with its three regions on their own loops", () => {
  const world = resolveRenderWorld("voltonaut-tour");

  expect(world.regions.map((region) => [region.id, region.biome.kind, region.home.id])).toEqual([
    ["forest", "forest", "voltonaut-forest"],
    ["coast", "coast", "voltonaut-coast"],
    ["night-city", "night-city", "voltonaut-night-city"],
  ]);
  expect(world.regionRoads).toHaveLength(12);
  expect(world.sideRoads("voltonaut-tour").map((road) => road.id)).toEqual([
    "forest:around",
    "coast:around",
    "night-city:around",
  ]);
  expect(world.sideRoads("voltonaut-coast")).toHaveLength(10);
  expect(resolveRenderWorld("voltonaut-coast").regions).toHaveLength(3);
});

it("refuses a world whose region has no home path to dress", () => {
  const data = singleRouteWorld(TEST_LOOP, "1");

  const homeless = createWorld({
    ...data,
    regions: [...data.regions, { id: "crossed", name: "Crossed", scenery: "coast" }],
  });

  expect(() => renderWorldOf(homeless)).toThrow("Region crossed has no home path to dress");
  expect(() => resolveRenderWorld("missing")).toThrow("Unsupported render route: missing");
});
