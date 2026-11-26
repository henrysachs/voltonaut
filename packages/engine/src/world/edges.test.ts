import { expect, it } from "vitest";

import type { CenterlinePoint } from "../elevation/route.js";

import type { RoadEdge, WorldData, WorldNode } from "./types.js";
import { createWorld } from "./world.js";

const EDGE: RoadEdge = {
  id: "ab",
  regionId: "forest",
  fromNodeId: "a",
  toNodeId: "b",
  lengthM: 100,
  centerline: [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 100, z: 0 },
  ],
  profileSamples: [
    { distanceM: 0, elevationM: 10 },
    { distanceM: 100, elevationM: 30 },
  ],
};

const NODE_A: WorldNode = { id: "a", x: 0, z: 0, elevationM: 10 };
const NODE_B: WorldNode = { id: "b", x: 100, z: 0, elevationM: 30 };

function withEdge(overrides: Partial<RoadEdge>): WorldData {
  return {
    id: "line",
    name: "Line",
    revision: "1",
    regions: [{ id: "forest", name: "Forest", scenery: "mixed" }],
    nodes: [NODE_A, NODE_B],
    edges: [{ ...EDGE, ...overrides }],
    paths: [],
  };
}

function flatSamples(lengthM: number): RoadEdge["profileSamples"] {
  return [
    { distanceM: 0, elevationM: 10 },
    { distanceM: lengthM, elevationM: 30 },
  ];
}

function moved(start: CenterlinePoint, end: CenterlinePoint): WorldData {
  return withEdge({ centerline: [start, { x: 50, z: 0 }, end] });
}

function elevations(startM: number, endM: number): WorldData {
  return withEdge({
    profileSamples: [
      { distanceM: 0, elevationM: startM },
      { distanceM: 100, elevationM: endM },
    ],
  });
}

it("accepts a valid edge without paths", () => {
  expect(createWorld(withEdge({})).routes).toEqual([]);
});

it("rejects edges in an unknown region", () => {
  expect(() => createWorld(withEdge({ regionId: "sea" }))).toThrow(
    "edge ab references unknown region sea",
  );
});

it("rejects a kink inside an edge", () => {
  const bentM = 2 * Math.hypot(50, 6);

  const bent = (offsetM: number) =>
    withEdge({
      lengthM: 2 * Math.hypot(50, offsetM),
      profileSamples: flatSamples(2 * Math.hypot(50, offsetM)),
      centerline: [
        { x: 0, z: 0 },
        { x: 50, z: offsetM },
        { x: 100, z: 0 },
      ],
    });

  expect(bentM).toBeGreaterThan(100);
  expect(() => createWorld(bent(4))).not.toThrow();
  expect(() => createWorld(bent(6))).toThrow(/^edge ab kinks by 0\.23\d* rad at point 1/u);
});

it("rejects edges with unknown nodes", () => {
  expect(() => createWorld(withEdge({ fromNodeId: "x" }))).toThrow(
    "edge ab references an unknown node",
  );
  expect(() => createWorld(withEdge({ toNodeId: "x" }))).toThrow(
    "edge ab references an unknown node",
  );
});

it("rejects edges with fewer than two points or samples", () => {
  const message = "edge ab needs at least 2 centerline points and samples";

  expect(() => createWorld(withEdge({ centerline: [{ x: 0, z: 0 }] }))).toThrow(message);
  expect(() =>
    createWorld(withEdge({ profileSamples: [{ distanceM: 0, elevationM: 10 }] })),
  ).toThrow(message);
});

it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])("rejects edge length %s", (lengthM) => {
  expect(() => createWorld(withEdge({ lengthM, profileSamples: flatSamples(lengthM) }))).toThrow(
    "edge ab lengthM must be positive and finite",
  );
});

it("checks the centerline arc length within 1e-6 m", () => {
  const message = "edge ab centerline arc length does not match lengthM";

  expect(() =>
    createWorld(withEdge({ lengthM: 100.01, profileSamples: flatSamples(100.01) })),
  ).toThrow(message);
  expect(() =>
    createWorld(withEdge({ lengthM: 99.99, profileSamples: flatSamples(99.99) })),
  ).toThrow(message);
  expect(() =>
    createWorld(withEdge({ lengthM: 100 + 5e-7, profileSamples: flatSamples(100 + 5e-7) })),
  ).not.toThrow();
  expect(() =>
    createWorld(withEdge({ lengthM: 100 - 5e-7, profileSamples: flatSamples(100 - 5e-7) })),
  ).not.toThrow();
});

it("requires the profile to span exactly 0 to lengthM", () => {
  const message = "edge ab profile must span exactly 0 to lengthM";

  const late = [
    { distanceM: 1, elevationM: 10 },
    { distanceM: 100, elevationM: 30 },
  ];

  expect(() => createWorld(withEdge({ profileSamples: late }))).toThrow(message);
  expect(() => createWorld(withEdge({ profileSamples: flatSamples(99) }))).toThrow(message);
});

it("requires edges to meet their nodes exactly in X and Z", () => {
  expect(() => createWorld(moved({ x: 1e-9, z: 0 }, { x: 100, z: 0 }))).toThrow(
    "edge ab does not meet node a exactly",
  );
  expect(() => createWorld(moved({ x: 0, z: 1e-9 }, { x: 100, z: 0 }))).toThrow(
    "edge ab does not meet node a exactly",
  );
  expect(() => createWorld(moved({ x: 0, z: 0 }, { x: 100, z: 1e-9 }))).toThrow(
    "edge ab does not meet node b exactly",
  );
});

it("matches node elevations within 1e-6 m at both ends", () => {
  expect(() => createWorld(elevations(10 + 5e-7, 30 - 5e-7))).not.toThrow();
  expect(() => createWorld(elevations(10 + 2e-6, 30))).toThrow(
    "edge ab elevation does not match node a",
  );
  expect(() => createWorld(elevations(10 - 2e-6, 30))).toThrow(
    "edge ab elevation does not match node a",
  );
  expect(() => createWorld(elevations(10, 30 + 2e-6))).toThrow(
    "edge ab elevation does not match node b",
  );
});

it("accepts a node elevation offset of exactly 1e-6 m", () => {
  const world = withEdge({
    profileSamples: [
      { distanceM: 0, elevationM: 1e-6 },
      { distanceM: 100, elevationM: 30 },
    ],
  });

  expect(() =>
    createWorld({ ...world, nodes: [{ ...NODE_A, elevationM: 0 }, NODE_B] }),
  ).not.toThrow();
});
