import { expect, it } from "vitest";

import { NIGHT_CITY } from "../../elevation/data/night-city.js";
import type { RouteData } from "../../elevation/route.js";
import { createWorld } from "../world.js";

import { regionTourWorld, type TourRegion, type TourWorldSpec } from "./regionTour.js";

function spec(regions: readonly TourRegion[]): TourWorldSpec {
  return {
    id: "t",
    name: "T",
    revision: "3",
    tourId: "t-tour",
    tourName: "Tour",
    chordM: 10,
    regions,
  };
}

function region(id: string, x: number, loop: RouteData = NIGHT_CITY): TourRegion {
  return { id, name: id.toUpperCase(), scenery: id, loop, offset: { x, z: 0 } };
}

function requireRoute(id: string): RouteData {
  const route = createWorld(regionTourWorld(spec([region("a", 0), region("b", 6000)]))).route(id);

  if (route === undefined) throw new Error(`tour world has no path ${id}`);

  return route;
}

it("joins two regions into a smooth tour with one loop per region", () => {
  const data = regionTourWorld(spec([region("a", 0), region("b", 6000)]));
  const world = createWorld(data);

  expect(data).toMatchObject({ id: "t", name: "T", revision: "3" });
  expect(data.regions).toEqual([
    { id: "a", name: "A", scenery: "a" },
    { id: "b", name: "B", scenery: "b" },
  ]);
  expect(data.nodes.map((node) => node.id)).toEqual([
    "a:entry",
    "a:exit",
    "a-b:border",
    "b:entry",
    "b:exit",
    "b-a:border",
  ]);
  expect(world.routes.map((route) => [route.id, route.name])).toEqual([
    ["t-tour", "Tour"],
    ["t-a", "A"],
    ["t-b", "B"],
  ]);
  expect(world.regions.map((entry) => entry.homePathId)).toEqual(["t-a", "t-b"]);
});

it("moves each region loop by its offset and keeps the loop length", () => {
  const loop = requireRoute("t-b");

  expect(Math.min(...loop.centerline.map((point) => point.x))).toBeGreaterThan(4000);
  expect(loop.lengthM).toBeCloseTo(NIGHT_CITY.lengthM, 6);
});

it("leaves towards the next region and arrives from the previous one", () => {
  const data = regionTourWorld(spec([region("a", 0), region("b", 6000)]));
  const exit = data.nodes.find((node) => node.id === "a:exit");
  const entry = data.nodes.find((node) => node.id === "a:entry");

  expect(exit?.z).toBeLessThan(0);
  expect(entry?.z).toBeGreaterThan(0);
});

it("rejects a region that would enter and leave at the same vertex", () => {
  expect(() => regionTourWorld(spec([region("a", 0)]))).toThrow(
    "region a enters and leaves at the same vertex",
  );
});
