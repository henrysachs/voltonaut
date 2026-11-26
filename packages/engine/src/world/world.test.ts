import { expect, it } from "vitest";

import type { CenterlinePoint, RouteData } from "../elevation/route.js";
import { createRoute } from "../elevation/route.js";

import type { PathStep, RoadEdge, WorldData, WorldPath } from "./types.js";
import { createWorld } from "./world.js";

const RING_RADIUS_M = 50;
const RING_POINTS = 32;

function ringPoint(index: number): CenterlinePoint {
  const angleRad = (2 * Math.PI * (index % RING_POINTS)) / RING_POINTS;

  return { x: RING_RADIUS_M * Math.cos(angleRad), z: RING_RADIUS_M * Math.sin(angleRad) };
}

function polylineM(points: readonly CenterlinePoint[]): number {
  return points
    .slice(1)
    .reduce(
      (sumM, point, index) =>
        sumM + Math.hypot(point.x - (points[index]?.x ?? 0), point.z - (points[index]?.z ?? 0)),
      0,
    );
}

function ringEdge(id: string, fromIndex: number, from: string, to: string): RoadEdge {
  const centerline = Array.from({ length: RING_POINTS / 2 + 1 }, (_, step) =>
    ringPoint(fromIndex + step),
  );

  const lengthM = polylineM(centerline);
  const fromM = from === "east" ? 10 : 20;

  return {
    id,
    regionId: from === "east" ? "forest" : "coast",
    fromNodeId: from,
    toNodeId: to,
    lengthM,
    centerline,
    profileSamples: [
      { distanceM: 0, elevationM: fromM },
      { distanceM: lengthM, elevationM: 30 - fromM },
    ],
  };
}

const LINE_EDGES: readonly RoadEdge[] = [
  {
    id: "ab",
    regionId: "forest",
    fromNodeId: "a",
    toNodeId: "b",
    lengthM: 100,
    centerline: [
      { x: 0, z: 200 },
      { x: 50, z: 200 },
      { x: 100, z: 200 },
    ],
    profileSamples: [
      { distanceM: 0, elevationM: 10 },
      { distanceM: 100, elevationM: 10 },
    ],
  },
  {
    id: "bc",
    regionId: "coast",
    fromNodeId: "b",
    toNodeId: "c",
    lengthM: 100,
    centerline: [
      { x: 100, z: 200 },
      { x: 200, z: 200 },
    ],
    profileSamples: [
      { distanceM: 0, elevationM: 10 },
      { distanceM: 40, elevationM: 12 },
      { distanceM: 100, elevationM: 20 },
    ],
  },
  {
    id: "bd",
    regionId: "coast",
    fromNodeId: "b",
    toNodeId: "d",
    lengthM: 100,
    centerline: [
      { x: 100, z: 200 },
      { x: 100, z: 300 },
    ],
    profileSamples: [
      { distanceM: 0, elevationM: 10 },
      { distanceM: 100, elevationM: 10 },
    ],
  },
];

const FORWARD: readonly PathStep[] = [
  { edgeId: "ab", direction: "forward" },
  { edgeId: "bc", direction: "forward" },
];

const NORTH_M = ringEdge("north", 0, "east", "west").lengthM;
const SOUTH_M = ringEdge("south", RING_POINTS / 2, "west", "east").lengthM;

const RING: readonly PathStep[] = [
  { edgeId: "north", direction: "forward" },
  { edgeId: "south", direction: "forward" },
];

function path(id: string, steps: readonly PathStep[], loop = false): WorldPath {
  return { id, name: `Path ${id}`, loop, steps, segments: [] };
}

function network(paths: readonly WorldPath[]): WorldData {
  return {
    id: "net",
    name: "Network",
    revision: "7",
    regions: [
      { id: "forest", name: "Forest", scenery: "mixed" },
      { id: "coast", name: "Coast", scenery: "coast" },
    ],
    nodes: [
      { id: "a", x: 0, z: 200, elevationM: 10 },
      { id: "b", x: 100, z: 200, elevationM: 10 },
      { id: "c", x: 200, z: 200, elevationM: 20 },
      { id: "d", x: 100, z: 300, elevationM: 10 },
      { id: "east", ...ringPoint(0), elevationM: 10 },
      { id: "west", ...ringPoint(RING_POINTS / 2), elevationM: 20 },
    ],
    edges: [
      ...LINE_EDGES,
      ringEdge("north", 0, "east", "west"),
      ringEdge("south", RING_POINTS / 2, "west", "east"),
    ],
    paths,
  };
}

function routeOf(paths: readonly WorldPath[], pathId: string): RouteData {
  const route = createWorld(network(paths)).route(pathId);

  if (route === undefined) {
    throw new Error(`missing path ${pathId}`);
  }

  return route;
}

it("joins forward edges, keeps each junction once and starts in the first region", () => {
  expect(routeOf([path("up", FORWARD)], "up")).toStrictEqual({
    id: "up",
    name: "Path up",
    lengthM: 200,
    loop: false,
    centerline: [
      { x: 0, z: 200 },
      { x: 50, z: 200 },
      { x: 100, z: 200 },
      { x: 200, z: 200 },
    ],
    profileSamples: [
      { distanceM: 0, elevationM: 10 },
      { distanceM: 100, elevationM: 10 },
      { distanceM: 140, elevationM: 12 },
      { distanceM: 200, elevationM: 20 },
    ],
    segments: [],
    scenery: "mixed",
  });
});

it("drives a joined path through the engine route", () => {
  const route = createRoute(routeOf([path("up", FORWARD)], "up"));

  expect(route.worldPos(150)).toStrictEqual({ x: 150, y: 12 + (10 / 60) * 8, z: 200 });
  expect(route.profile.gradeAt(170)).toBeCloseTo((8 / 60) * 100, 10);
});

it("reverses edges with mirrored distances", () => {
  const back = path("back", [
    { edgeId: "bc", direction: "reverse" },
    { edgeId: "ab", direction: "reverse" },
  ]);

  const route = routeOf([back], "back");

  expect(route.centerline).toStrictEqual([
    { x: 200, z: 200 },
    { x: 100, z: 200 },
    { x: 50, z: 200 },
    { x: 0, z: 200 },
  ]);
  expect(route.profileSamples).toStrictEqual([
    { distanceM: 0, elevationM: 20 },
    { distanceM: 60, elevationM: 12 },
    { distanceM: 100, elevationM: 10 },
    { distanceM: 200, elevationM: 10 },
  ]);
  expect(route.scenery).toBe("coast");
  expect(createRoute(route).profile.gradeAt(30)).toBeCloseTo((-8 / 60) * 100, 10);
  expect(LINE_EDGES[1]?.profileSamples[1]).toStrictEqual({ distanceM: 40, elevationM: 12 });
});

it("closes a loop through two regions with a segment across the junction", () => {
  const segments = [{ id: "crest", name: "Crest", kind: "kom", startM: 100, endM: 200 }] as const;
  const route = routeOf([{ ...path("ring", RING, true), segments }], "ring");

  expect(route.lengthM).toBe(NORTH_M + SOUTH_M);
  expect(route.centerline).toHaveLength(RING_POINTS + 1);
  expect(route.centerline.at(-1)).toStrictEqual(route.centerline[0]);
  expect(route.segments).toBe(segments);
  expect(createRoute(route).profile.elevationAt(NORTH_M)).toBe(20);
  expect(() => createRoute(route)).not.toThrow();
});

it("lists routes in path order and exposes world identity", () => {
  const world = createWorld(network([path("up", FORWARD), path("short", FORWARD.slice(0, 1))]));

  expect(world).toMatchObject({ id: "net", name: "Network", revision: "7" });
  expect(world.routes.map((route) => [route.id, route.lengthM])).toEqual([
    ["up", 200],
    ["short", 100],
  ]);
  expect(world.route("short")).toBe(world.routes[1]);
  expect(world.route("missing")).toBeUndefined();
});

it("rejects a kink where two edges meet", () => {
  const turn = path("turn", [
    { edgeId: "ab", direction: "forward" },
    { edgeId: "bd", direction: "forward" },
  ]);

  expect(() => createWorld(network([turn]))).toThrow(
    /^path turn kinks by 1\.57\d* rad at point 2/u,
  );
  expect(() => createWorld(network([path("half", RING.slice(0, 1))]))).not.toThrow();
});

it("rejects empty and unknown steps", () => {
  const unknown = path("zz", [{ edgeId: "zz", direction: "forward" }]);

  expect(() => createWorld(network([path("none", [])]))).toThrow("path none has no steps");
  expect(() => createWorld(network([unknown]))).toThrow("path zz references unknown edge zz");
});

it("rejects disconnected paths and unclosed loops", () => {
  const twice = path("twice", [
    { edgeId: "ab", direction: "forward" },
    { edgeId: "ab", direction: "forward" },
  ]);

  const wrongWay = path("wrong", [
    { edgeId: "ab", direction: "forward" },
    { edgeId: "bc", direction: "reverse" },
  ]);

  expect(() => createWorld(network([twice]))).toThrow("path twice is not connected at edge ab");
  expect(() => createWorld(network([wrongWay]))).toThrow("path wrong is not connected at edge bc");
  expect(() => createWorld(network([path("open", FORWARD, true)]))).toThrow(
    "loop path open does not return to its start node",
  );
});

it("requires a revision and unique ids", () => {
  const base = network([path("up", FORWARD)]);
  const extraNode = { id: "a", x: 1, z: 1, elevationM: 0 };
  const extraRegion = { id: "coast", name: "Again", scenery: "coast" };

  expect(() => createWorld({ ...base, revision: "" })).toThrow("world net needs a revision");
  expect(() => createWorld({ ...base, regions: [...base.regions, extraRegion] })).toThrow(
    "duplicate region id coast",
  );
  expect(() => createWorld({ ...base, nodes: [...base.nodes, extraNode] })).toThrow(
    "duplicate node id a",
  );
  expect(() => createWorld({ ...base, edges: [...base.edges, ...LINE_EDGES.slice(0, 1)] })).toThrow(
    "duplicate edge id ab",
  );
  expect(() => createWorld(network([path("up", FORWARD), path("up", FORWARD)]))).toThrow(
    "duplicate path id up",
  );
});
