import { createRoute, TEST_LOOP } from "@voltonaut/engine";
import * as THREE from "three";
import { afterAll, expect, it } from "vitest";

import { heightAt } from "./heightfield.js";
import { lakeRadius, offsetPosition } from "./lake-plan.js";
import { createLandscapePlan, PLANT_ROAD_CLEARANCE_M, terrainPosition } from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import { createTerrain, createTerrainGeometries, RENDER_CHUNK_TILES } from "./terrain.js";

const route = createRoute(TEST_LOOP);
const plan = createLandscapePlan(route);
const terrain = createTerrain(plan);
const ray = new THREE.Raycaster();

terrain.updateMatrixWorld(true);

interface Hit {
  readonly y: number;
  readonly normalY: number;
}

/** Casts straight down onto the real terrain meshes. */
function hitTerrain(x: number, z: number): Hit {
  ray.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(terrain)[0];

  return { y: hit?.point.y ?? Number.NaN, normalY: hit?.face?.normal.y ?? Number.NaN };
}

/** Every drawn terrain vertex keyed by XZ position, as "height normal" text per occurrence. */
function drawnVertices(): ReadonlyMap<string, readonly string[]> {
  const vertices = new Map<string, string[]>();

  for (const geometry of createTerrainGeometries(plan)) {
    const position = geometry.getAttribute("position");

    const normal = geometry.getAttribute("normal");

    for (let index = 0; index < position.count; index += 1) {
      const key = `${position.getX(index)}:${position.getZ(index)}`;
      const entries = vertices.get(key) ?? [];

      entries.push(
        [position.getY(index), normal.getX(index), normal.getY(index), normal.getZ(index)]
          .map((value) => value.toFixed(4))
          .join(" "),
      );
      vertices.set(key, entries);
    }

    geometry.dispose();
  }

  return vertices;
}

it("repeats the same original forest for the same seed and varies placement for another seed", () => {
  expect(createLandscapePlan(route)).toEqual(plan);
  expect(createLandscapePlan(route, [route], 43).trees).not.toEqual(plan.trees);
  expect(plan.trees.length).toBeGreaterThan(1000);
  expect(plan.trees.filter((plant) => plant.routeDistanceM < 400).length).toBeGreaterThan(50);
});

it("keeps full tree crowns and rocks off the actual asphalt and outside the lake", () => {
  const centerline = Array.from({ length: 2500 }, (_, index) => route.worldPos(index * 4));

  for (const plant of [...plan.trees, ...plan.rocks]) {
    const distanceM = Math.min(
      ...centerline.map((point) =>
        Math.hypot(point.x - plant.position.x, point.z - plant.position.z),
      ),
    );

    expect(distanceM - plant.radiusM).toBeGreaterThan(PLANT_ROAD_CLEARANCE_M);
    expect(lakeRadius(plan.lake, plant.position)).toBeGreaterThanOrEqual(1.2);
    expect(plant.routeDistanceM).toBeLessThan(route.lengthM);
    expect(plant.position.y).toBe(heightAt(plan.terrain, plant.position.x, plant.position.z));
  }
});

it("places the lake below the start road, above its bed and inside a dry shore", () => {
  expect(plan.lake.waterYM).toBeLessThan(route.worldPos(110).y - 1);
  expect(terrainPosition(plan, 110, -58).y).toBeLessThan(plan.lake.waterYM - 1);
  expect(terrainPosition(plan, 110, -10).y).toBeGreaterThan(plan.lake.waterYM);
  expect(terrainPosition(plan, 110, -108).y).toBeGreaterThan(plan.lake.waterYM);

  for (let distanceM = 0; distanceM < route.lengthM; distanceM += 4) {
    expect(lakeRadius(plan.lake, route.worldPos(distanceM))).toBeGreaterThan(1.1);
  }
});

it("draws exactly the planned raster under road, lake, trees and open land, facing up", () => {
  const probes = [
    ...[0, 110, 2999, 5000, 9999].flatMap((distanceM) =>
      [-3.5, 0, 3.5, -40, 70].map((lateralM) => offsetPosition(route, distanceM, lateralM)),
    ),
    plan.lake.center,
    ...plan.trees.slice(0, 10).map((tree) => tree.position),
    ...plan.rocks.slice(0, 5).map((rock) => rock.position),
    { x: 0, y: 0, z: 0 },
  ];

  for (const probe of probes) {
    const hit = hitTerrain(probe.x, probe.z);

    expect(Math.abs(hit.y - heightAt(plan.terrain, probe.x, probe.z))).toBeLessThanOrEqual(1e-3);
    expect(hit.normalY).toBeGreaterThan(0);
  }
});

it("merges 4 × 4 tiles per mesh and shares heights and normals across every tile seam", () => {
  const shared = [...drawnVertices().values()].filter((entries) => entries.length > 1);

  expect(terrain.children).toHaveLength(
    Math.ceil(plan.terrain.columns / RENDER_CHUNK_TILES) *
      Math.ceil(plan.terrain.rows / RENDER_CHUNK_TILES),
  );
  expect(shared.length).toBeGreaterThan(1000);
  expect(shared.filter((entries) => new Set(entries).size > 1)).toEqual([]);
});

afterAll(() => {
  disposeObject(terrain);
});
