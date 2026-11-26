import {
  ALPINE_PASS,
  COAST_LOOP,
  createRoute,
  NIGHT_CITY,
  TEST_LOOP,
  type EngineRoute,
} from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createLandscapePlan, offsetPosition, terrainPosition } from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import { createTerrain } from "./terrain.js";

const CELL_M = 20;

/** Asphalt and shoulder reach 4 m from the centre line (road.ts). */
const ROAD_HALF_WIDTH_M = 4;

/** The asphalt sits this far above the route height; terrain must stay below it. */
const ASPHALT_LIFT_M = 0.025;

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type Triangle = readonly [Point, Point, Point];

/** World-space vertices and triangle indices of the named terrain mesh. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test reads the geometry owned by this mutable Three group.
function terrainTriangles(terrain: THREE.Group): readonly Triangle[] {
  const mesh = terrain.getObjectByName("route-terrain");

  const geometry: unknown = mesh instanceof THREE.Mesh ? mesh.geometry : undefined;

  const positions: unknown =
    geometry instanceof THREE.BufferGeometry ? geometry.getAttribute("position") : undefined;

  const index = geometry instanceof THREE.BufferGeometry ? geometry.getIndex() : null;

  const indexed = positions instanceof THREE.BufferAttribute && index !== null;

  if (mesh === undefined || !indexed)
    throw new Error("The terrain system must own a named, indexed terrain mesh");

  terrain.updateMatrixWorld(true);

  const point = (at: number): Point => {
    const { x, y, z } = new THREE.Vector3()
      .fromBufferAttribute(positions, index.getX(at))
      .applyMatrix4(mesh.matrixWorld);

    return { x, y, z };
  };

  const triangles: Triangle[] = [];

  for (let at = 0; at < index.count; at += 3)
    triangles.push([point(at), point(at + 1), point(at + 2)]);

  return triangles;
}

/** Terrain triangles bucketed by the grid cells their bounds touch. */
function terrainGrid(triangles: readonly Triangle[]): ReadonlyMap<string, readonly Triangle[]> {
  const grid = new Map<string, Triangle[]>();

  for (const triangle of triangles) {
    const xs = triangle.map(({ x }) => Math.floor(x / CELL_M));
    const zs = triangle.map(({ z }) => Math.floor(z / CELL_M));

    for (let cx = Math.min(...xs); cx <= Math.max(...xs); cx += 1)
      for (let cz = Math.min(...zs); cz <= Math.max(...zs); cz += 1) {
        const key = `${cx}:${cz}`;
        const bucket = grid.get(key) ?? [];

        bucket.push(triangle);
        grid.set(key, bucket);
      }
  }

  return grid;
}

/** Height of the triangle above (x, z), or undefined outside it. */
function heightAt([a, b, c]: Triangle, x: number, z: number): number | undefined {
  const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);

  if (Math.abs(determinant) < 1e-9) return undefined;

  const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / determinant;
  const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / determinant;

  return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8
    ? u * a.y + v * b.y + (1 - u - v) * c.y
    : undefined;
}

/** Road probes whose surface lies below some terrain triangle, as "distance:lateral:excess". */
function buriedRoad(
  route: EngineRoute,
  grid: Readonly<ReadonlyMap<string, readonly Triangle[]>>,
): string[] {
  const buried: string[] = [];

  for (let distanceM = 0; distanceM < route.lengthM; distanceM += 5) {
    for (const lateralM of [-ROAD_HALF_WIDTH_M, -3.5, 0, 3.5, ROAD_HALF_WIDTH_M]) {
      const road = offsetPosition(route, distanceM, lateralM);
      const key = `${Math.floor(road.x / CELL_M)}:${Math.floor(road.z / CELL_M)}`;

      const heights = (grid.get(key) ?? []).flatMap(
        (triangle) => heightAt(triangle, road.x, road.z) ?? [],
      );

      const highest = Math.max(-Infinity, ...heights);

      if (highest > road.y + ASPHALT_LIFT_M)
        buried.push(`${distanceM}:${lateralM}:${(highest - road.y).toFixed(3)}`);
    }
  }

  return buried;
}

it.each([
  ["alpine pass", ALPINE_PASS, false],
  ["test loop", TEST_LOOP, true],
  ["coast loop", COAST_LOOP, true],
  ["night city", NIGHT_CITY, false],
] as const)(
  "keeps every %s terrain triangle below the whole road, turns included",
  (_name, data, withLake) => {
    const route = createRoute(data);
    const terrain = createTerrain(createLandscapePlan(route, 42, withLake));

    expect(buriedRoad(route, terrainGrid(terrainTriangles(terrain)))).toEqual([]);
    disposeObject(terrain);
  },
);

it("sees the 45° turn at the alpine lap line from both sides of the seam", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, 42, false);
  const center = route.worldPos(0);
  const atStart = terrainPosition(plan, 0, 100);
  const atEnd = terrainPosition(plan, route.lengthM, 100);

  // Without wrapping, the window at 0 m sees only the first leg and keeps the full 100 m offset.
  expect(Math.hypot(atStart.x - center.x, atStart.z - center.z)).toBeLessThan(80);
  expect(atStart).toEqual(atEnd);
});
