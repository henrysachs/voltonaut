import { expect, it } from "vitest";

import { createRoute, type RouteData } from "../../elevation/route.js";
import type { RoadEdge } from "../types.js";
import { createWorld } from "../world.js";

import { VOLTONAUT, VOLTONAUT_REVISION_2 } from "./index.js";
import { VOLTONAUT_WORLD_REVISION_2 } from "./voltonaut.js";

/** Junction surroundings where roads meet or merge on purpose. */
const MERGE_ZONE_M = 400;

function requireEdge(id: string): RoadEdge {
  const edge = VOLTONAUT_WORLD_REVISION_2.edges.find((candidate) => candidate.id === id);

  if (edge === undefined) throw new Error(`voltonaut revision 2 has no edge ${id}`);

  return edge;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new RangeError("test data is missing");

  return value;
}

function requireRoute(id: string): RouteData {
  const route = VOLTONAUT_REVISION_2.route(id);

  if (route === undefined) throw new Error(`voltonaut revision 2 has no path ${id}`);

  return route;
}

/** Closest approach of two edges away from the nodes they share (no crossings, ADR-033 §5). */
function gapM(aId: string, bId: string): number {
  const nodes = new Map(VOLTONAUT_WORLD_REVISION_2.nodes.map((node) => [node.id, node]));
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

it("is a valid smooth world with revision 2 next to revision 1", () => {
  expect(() => createWorld(VOLTONAUT_WORLD_REVISION_2)).not.toThrow();
  expect(VOLTONAUT_REVISION_2).toMatchObject({ id: "voltonaut", name: "Voltonaut", revision: "2" });
  expect(VOLTONAUT_WORLD_REVISION_2.legacyRoute).toBeUndefined();
  expect(VOLTONAUT.revision).toBe("1");
});

it("places the vineyard between forest and coast in the tour", () => {
  expect(VOLTONAUT_WORLD_REVISION_2.regions).toEqual([
    { id: "forest", name: "Wald und See", scenery: "mixed" },
    { id: "vineyard", name: "Weinberge", scenery: "vineyard" },
    { id: "coast", name: "Küste", scenery: "coast" },
    { id: "night-city", name: "Nachtstadt", scenery: "night-city" },
  ]);

  const steps = required(VOLTONAUT_WORLD_REVISION_2.paths[0]).steps;
  const regions = steps.map((step) => requireEdge(step.edgeId).regionId);

  expect([...new Set(regions)]).toEqual(["forest", "vineyard", "coast", "night-city"]);
  expect(steps.map((step) => step.edgeId)).toContain("forest-vineyard:out");
  expect(steps.map((step) => step.edgeId)).toContain("vineyard-coast:in");
  expect(() => createRoute(requireRoute("voltonaut-tour"))).not.toThrow();
});

it("names the tour and one loop per region for the route catalog", () => {
  expect(VOLTONAUT_REVISION_2.routes.map((route) => [route.id, route.name, route.scenery])).toEqual(
    [
      ["voltonaut-tour", "Voltonaut-Tour", "mixed"],
      ["voltonaut-forest", "Wald und See", "mixed"],
      ["voltonaut-vineyard", "Weinberg-Intervalle", "vineyard"],
      ["voltonaut-coast", "Küste", "coast"],
      ["voltonaut-night-city", "Nachtstadt", "night-city"],
    ],
  );
  expect(VOLTONAUT_REVISION_2.regions.map((region) => region.homePathId)).toEqual([
    "voltonaut-forest",
    "voltonaut-vineyard",
    "voltonaut-coast",
    "voltonaut-night-city",
  ]);
});

it("keeps the region loops at their shipped lengths and carries the KOM onto the home path", () => {
  const vineyard = requireRoute("voltonaut-vineyard");

  expect(requireRoute("voltonaut-forest").lengthM).toBeCloseTo(10_000, 6);
  expect(requireRoute("voltonaut-coast").lengthM).toBeCloseTo(8000, 6);
  expect(requireRoute("voltonaut-night-city").lengthM).toBeCloseTo(6000, 6);
  expect(vineyard.lengthM).toBeGreaterThanOrEqual(12_000);
  expect(vineyard.lengthM).toBeLessThanOrEqual(15_000);
  expect(vineyard.segments).toHaveLength(1);
  expect(vineyard.segments[0]).toMatchObject({ id: "rebhang-kom", kind: "kom" });
});

it("rides the KOM ramp of the home path at its profile grade", () => {
  const vineyard = requireRoute("voltonaut-vineyard");
  const route = createRoute(vineyard);
  const segment = required(vineyard.segments[0]);

  const riseM = route.profile.elevationAt(segment.endM) - route.profile.elevationAt(segment.startM);
  const gradePct = (riseM / (segment.endM - segment.startM)) * 100;

  expect(segment.endM - segment.startM).toBeCloseTo(700, 6);
  expect(Math.abs(gradePct - 5)).toBeLessThan(0.4);
});

it("keeps every pair of roads at least 36 m apart outside their junctions", () => {
  const ids = VOLTONAUT_WORLD_REVISION_2.edges.map((edge) => edge.id);
  const pairs = ids.flatMap((a, index) => ids.slice(index + 1).map((b) => [a, b] as const));
  const closestM = Math.min(...pairs.map(([a, b]) => gapM(a, b)));

  expect(pairs).toHaveLength(120);
  expect(closestM).toBeGreaterThanOrEqual(36);
});

it("keeps the region loops at least 1.8 km apart", () => {
  const loops = [
    "voltonaut-forest",
    "voltonaut-vineyard",
    "voltonaut-coast",
    "voltonaut-night-city",
  ].map((id) => requireRoute(id).centerline);

  const gaps = loops.flatMap((a, index) =>
    loops
      .slice(index + 1)
      .map((b) =>
        a.reduce(
          (nearestM, p) =>
            b.reduce(
              (closestM, q) => Math.min(closestM, Math.hypot(p.x - q.x, p.z - q.z)),
              nearestM,
            ),
          Number.POSITIVE_INFINITY,
        ),
      ),
  );

  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1800);
});

/** FNV-1a over every path's steps and every edge's chords and profile, rounded to the millimetre. */
function geometryFingerprint(): string {
  const paths = VOLTONAUT_WORLD_REVISION_2.paths.map((path) =>
    [
      path.id,
      path.loop,
      ...path.steps.map((step) => `${step.edgeId}/${step.direction}`),
      ...path.segments.map((segment) => `${segment.id}:${segment.startM.toFixed(3)}`),
    ].join(";"),
  );

  const text = [
    ...paths,
    ...VOLTONAUT_WORLD_REVISION_2.edges.map((edge) =>
      [
        edge.id,
        edge.regionId,
        edge.fromNodeId,
        edge.toNodeId,
        edge.lengthM.toFixed(3),
        ...edge.centerline.map((point) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`),
        ...edge.profileSamples.map(
          (sample) => `${sample.distanceM.toFixed(3)}:${sample.elevationM.toFixed(3)}`,
        ),
      ].join(";"),
    ),
  ].join("|");

  let hash = 0x81_1c_9d_c5;

  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93) >>> 0;

  return `${hash.toString(16)}:${text.length}`;
}

it("pins the geometry of revision 2: any change needs a new revision (ADR-033 §8)", () => {
  expect(VOLTONAUT_REVISION_2.revision).toBe("2");
  expect(geometryFingerprint()).toBe("7bb98226:198112");
});

/** Tour distances where the vineyard region begins and ends; apps/web/e2e/routes.spec.ts rides them. */
function vineyardSpanOfTourM(): readonly [number, number] {
  const steps = required(VOLTONAUT_WORLD_REVISION_2.paths[0]).steps;
  const lengths = steps.map((step) => requireEdge(step.edgeId).lengthM);
  const regions = steps.map((step) => requireEdge(step.edgeId).regionId);
  const first = regions.indexOf("vineyard");
  const last = regions.lastIndexOf("vineyard");
  const sum = (count: number): number => lengths.slice(0, count).reduce((a, b) => a + b, 0);

  return [sum(first), sum(last + 1)];
}

it("rides the vineyard region of the tour from 4.7 km to 13.9 km", () => {
  const [entryM, exitM] = vineyardSpanOfTourM();

  expect(entryM).toBeCloseTo(4675, -1);
  expect(exitM).toBeCloseTo(13_855, -1);
  expect(requireRoute("voltonaut-tour").lengthM).toBeCloseTo(32_086, -1);
});
