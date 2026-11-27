import { expect, it } from "vitest";

import { createRoute, type RouteData } from "../../elevation/route.js";
import { TEST_ROUTES } from "../../elevation/data/index.js";
import type { RoadEdge } from "../types.js";
import { createWorld } from "../world.js";

import { VOLTONAUT, WORLDS } from "./index.js";
import { VOLTONAUT_WORLD } from "./voltonaut.js";

/** Junction surroundings where roads meet or merge on purpose. */
const MERGE_ZONE_M = 400;

/** Closest approach of two edges away from the nodes they share (no crossings, ADR-033 §5). */
function gapM(aId: string, bId: string): number {
  const nodes = new Map(VOLTONAUT_WORLD.nodes.map((node) => [node.id, node]));
  const a = requireEdge(aId);
  const b = requireEdge(bId);

  const shared = [a.fromNodeId, a.toNodeId].flatMap((id) =>
    id === b.fromNodeId || id === b.toNodeId ? [nodes.get(id)] : [],
  );

  const free = a.centerline.filter((point) =>
    shared.every(
      (node) => Math.hypot(point.x - (node?.x ?? 0), point.z - (node?.z ?? 0)) >= MERGE_ZONE_M,
    ),
  );

  return free.reduce(
    (nearestM, p) =>
      b.centerline.reduce(
        (closestM, q) => Math.min(closestM, Math.hypot(p.x - q.x, p.z - q.z)),
        nearestM,
      ),
    Number.POSITIVE_INFINITY,
  );
}

function requireRoute(id: string): RouteData {
  const route = VOLTONAUT.route(id);

  if (route === undefined) throw new Error(`voltonaut has no path ${id}`);

  return route;
}

function requireEdge(id: string): RoadEdge {
  const edge = VOLTONAUT_WORLD.edges.find((candidate) => candidate.id === id);

  if (edge === undefined) throw new Error(`voltonaut has no edge ${id}`);

  return edge;
}

/** Regions the tour passes, in riding order. */
function tourRegions(): readonly string[] {
  const steps = VOLTONAUT_WORLD.paths[0]?.steps ?? [];

  return steps.map((step) => requireEdge(step.edgeId).regionId);
}

it("is a valid smooth world with revision 1", () => {
  expect(() => createWorld(VOLTONAUT_WORLD)).not.toThrow();
  expect(VOLTONAUT).toMatchObject({ id: "voltonaut", name: "Voltonaut", revision: "1" });
  expect(VOLTONAUT_WORLD.legacyRoute).toBeUndefined();
  expect(WORLDS.at(-1)).toBe(VOLTONAUT);
});

it("offers the tour and one loop per region as routes", () => {
  expect(VOLTONAUT.routes.map((route) => [route.id, route.loop, route.scenery])).toEqual([
    ["voltonaut-tour", true, "mixed"],
    ["voltonaut-forest", true, "mixed"],
    ["voltonaut-coast", true, "coast"],
    ["voltonaut-night-city", true, "night-city"],
  ]);
  expect(TEST_ROUTES["voltonaut-tour"]).toBe(VOLTONAUT.route("voltonaut-tour"));
});

it("rides the tour through every region without a break", () => {
  const tour = requireRoute("voltonaut-tour");

  expect([...new Set(tourRegions())]).toEqual(["forest", "coast", "night-city"]);
  expect(tourRegions()).toHaveLength(9);
  expect(tour.lengthM).toBeGreaterThan(30_000);
  expect(() => createRoute(tour)).not.toThrow();
});

it("keeps the region loops at their shipped lengths", () => {
  expect(requireRoute("voltonaut-forest").lengthM).toBeCloseTo(10_000, 6);
  expect(requireRoute("voltonaut-coast").lengthM).toBeCloseTo(8000, 6);
  expect(requireRoute("voltonaut-night-city").lengthM).toBeCloseTo(6000, 6);
});

it("keeps every pair of roads at least 25 m apart outside their junctions", () => {
  const ids = VOLTONAUT_WORLD.edges.map((edge) => edge.id);
  const pairs = ids.flatMap((a, index) => ids.slice(index + 1).map((b) => [a, b] as const));
  const closestM = Math.min(...pairs.map(([a, b]) => gapM(a, b)));

  expect(pairs).toHaveLength(66);
  expect(closestM).toBeGreaterThanOrEqual(25);
});

it("borders regions in the middle of each transition road", () => {
  const out = requireEdge("forest-coast:out");
  const inbound = requireEdge("forest-coast:in");

  expect([out.regionId, inbound.regionId]).toEqual(["forest", "coast"]);
  expect(out.toNodeId).toBe("forest-coast:border");
  expect(inbound.fromNodeId).toBe("forest-coast:border");
  expect(Math.abs(out.lengthM - inbound.lengthM)).toBeLessThan(20);
});
