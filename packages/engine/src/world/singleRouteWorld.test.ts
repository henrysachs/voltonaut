import { expect, it } from "vitest";

import {
  ALPINE_PASS,
  COAST_LOOP,
  FLAT_LOOP,
  KOM_CLIMB,
  NIGHT_CITY,
  TEST_ROUTES,
  TEST_LOOP,
} from "../elevation/data/index.js";
import type { RouteData } from "../elevation/route.js";
import { createRoute } from "../elevation/route.js";

import { SINGLE_ROUTE_WORLD_REVISION, TEST_WORLDS } from "./data/index.js";
import { singleRouteWorld } from "./singleRouteWorld.js";
import { createWorld } from "./world.js";

const SHIPPED = [FLAT_LOOP, TEST_LOOP, KOM_CLIMB, COAST_LOOP, ALPINE_PASS, NIGHT_CITY] as const;

function rewrapped(original: RouteData): RouteData {
  const [route] = createWorld(singleRouteWorld(original, "1")).routes;

  if (route === undefined) {
    throw new Error(`world for ${original.id} has no route`);
  }

  return route;
}

it("registers one world per shipped route with revision 1", () => {
  expect(SINGLE_ROUTE_WORLD_REVISION).toBe("1");
  expect(TEST_WORLDS.map((world) => [world.id, world.name, world.revision])).toEqual([
    ["flat-loop", "Flat Loop", "1"],
    ["test-loop", "Test Loop", "1"],
    ["kom-climb", "KOM Climb", "1"],
    ["coast-loop", "Coast Loop", "1"],
    ["alpine-pass", "Alpine Pass", "1"],
    ["night-city", "Night City", "1"],
  ]);
});

it.each(SHIPPED.map((route, index) => [route.id, index] as const))(
  "derives %s field by field from its world",
  (routeId, index) => {
    const world = TEST_WORLDS[index];

    expect(world?.routes).toStrictEqual([SHIPPED[index]]);
    expect(world?.route(routeId)).toStrictEqual(SHIPPED[index]);
    expect(TEST_ROUTES[routeId]).toStrictEqual(SHIPPED[index]);
  },
);

it("keeps TEST_ROUTES keyed by route id in shipping order", () => {
  expect(Object.keys(TEST_ROUTES)).toEqual([
    "flat-loop",
    "test-loop",
    "kom-climb",
    "coast-loop",
    "alpine-pass",
    "night-city",
  ]);
});

it.each(SHIPPED)("$id samples identical positions, headings and grades", (original) => {
  const before = createRoute(original);
  const derived = rewrapped(original);
  const after = createRoute(derived);

  expect(derived).not.toBe(original);

  for (let distanceM = -250; distanceM <= original.lengthM + 250; distanceM += 7.3) {
    expect(after.worldPos(distanceM)).toStrictEqual(before.worldPos(distanceM));
    expect(after.headingRad(distanceM)).toBe(before.headingRad(distanceM));
    expect(after.profile.gradeAt(distanceM)).toBe(before.profile.gradeAt(distanceM));
  }
});

it("uses one node and a closing edge for a loop", () => {
  const world = singleRouteWorld(TEST_LOOP, "1");

  expect(world.nodes).toStrictEqual([
    { id: "test-loop:start", x: 1591.5520489158457, z: 0, elevationM: 100 },
  ]);
  expect(world.edges).toHaveLength(1);
  expect(world.edges[0]).toMatchObject({
    id: "test-loop",
    fromNodeId: "test-loop:start",
    toNodeId: "test-loop:start",
    lengthM: 10_000,
  });
  expect(world.edges[0]?.centerline).toBe(TEST_LOOP.centerline);
  expect(world.edges[0]?.profileSamples).toBe(TEST_LOOP.profileSamples);
});

it("uses two nodes and keeps path metadata for an open route", () => {
  const world = singleRouteWorld(KOM_CLIMB, "2");

  expect(world).toMatchObject({ id: "kom-climb", name: "KOM Climb", revision: "2" });
  expect(world.nodes).toStrictEqual([
    { id: "kom-climb:start", x: 0, z: 0, elevationM: 100 },
    { id: "kom-climb:end", x: 2500, z: 0, elevationM: 300 },
  ]);
  expect(world.edges[0]).toMatchObject({
    fromNodeId: "kom-climb:start",
    toNodeId: "kom-climb:end",
  });
  expect(world.paths).toStrictEqual([
    {
      id: "kom-climb",
      name: "KOM Climb",
      loop: false,
      steps: [{ edgeId: "kom-climb", direction: "forward" }],
      segments: [],
    },
  ]);
  expect(world.regions).toStrictEqual([{ id: "kom-climb", name: "KOM Climb", scenery: "alpine" }]);
  expect(world.edges[0]?.regionId).toBe("kom-climb");
  expect(singleRouteWorld(TEST_LOOP, "1").paths[0]?.segments).toBe(TEST_LOOP.segments);
});

it.each([
  ["centerline", { ...KOM_CLIMB, centerline: [] }],
  ["profile", { ...KOM_CLIMB, profileSamples: [] }],
] as const)("rejects a route without %s", (_part, route) => {
  expect(() => singleRouteWorld(route, "1")).toThrow(
    "route kom-climb has no centerline or profile",
  );
});

const BENT_M = 10 + Math.hypot(10, 1);

it("places the end node at the last point of a multi-chord open route", () => {
  const bent: RouteData = {
    ...KOM_CLIMB,
    id: "bent",
    lengthM: BENT_M,
    centerline: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 1 },
    ],
    profileSamples: [
      { distanceM: 0, elevationM: 5 },
      { distanceM: BENT_M, elevationM: 7 },
    ],
  };

  expect(singleRouteWorld(bent, "1").nodes).toStrictEqual([
    { id: "bent:start", x: 0, z: 0, elevationM: 5 },
    { id: "bent:end", x: 20, z: 1, elevationM: 7 },
  ]);
  expect(rewrapped(bent)).toStrictEqual(bent);
});
