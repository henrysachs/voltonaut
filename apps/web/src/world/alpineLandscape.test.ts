import { ALPINE_PASS, createRoute, type EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import {
  createLandscapePlan,
  offsetPosition,
  TERRAIN_OFFSETS_M,
  terrainPosition,
} from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import { createTerrain } from "./terrain.js";

interface TerrainWindow {
  readonly startM: number;
  readonly endM: number;
}

interface AlpineHit {
  readonly point: { readonly y: number };
  readonly face?: { readonly normal: { readonly y: number } } | null | undefined;
}

type DrawRangeGeometry = Pick<THREE.BufferGeometry, "setDrawRange">;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test reads geometry owned by this mutable Three group.
function landGeometry(terrain: Readonly<THREE.Group>): DrawRangeGeometry {
  const mesh = terrain.getObjectByName("route-terrain");

  if (mesh instanceof THREE.Mesh && mesh.geometry instanceof THREE.BufferGeometry) {
    return mesh.geometry;
  }

  throw new Error("The terrain system must own a named terrain mesh");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test reads geometry owned by this mutable Three group.
function requiredApronGeometry(terrain: Readonly<THREE.Group>): DrawRangeGeometry {
  const apron = terrain.getObjectByName("road-terrain");

  if (apron instanceof THREE.Mesh && apron.geometry instanceof THREE.BufferGeometry) {
    return apron.geometry;
  }

  throw new Error("Alpine terrain must own a road apron");
}

function alpineSampleDistanceM(
  route: Readonly<EngineRoute>,
  sample: number,
  rowCount: number,
): number {
  return sample === rowCount ? route.lengthM - 0.01 : sample * 10 + 0.01;
}

function alpineTerrainWindows(
  route: Readonly<EngineRoute>,
  distanceM: number,
  nearbyM: number,
): readonly TerrainWindow[] {
  const windows: TerrainWindow[] = [
    {
      startM: Math.max(0, distanceM - nearbyM),
      endM: Math.min(route.lengthM, distanceM + nearbyM),
    },
  ];

  if (route.loop && distanceM < nearbyM) {
    windows.push({ startM: route.lengthM - nearbyM, endM: route.lengthM });
  }

  return windows;
}

function alpineShoulderHit(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three raycasting owns the mutable scene traversal.
  terrain: Readonly<THREE.Group>,
  geometry: DrawRangeGeometry,
  apronGeometry: DrawRangeGeometry,
  route: Readonly<EngineRoute>,
  distanceM: number,
  lateralM: number,
  nearbyM: number,
): AlpineHit | undefined {
  const indicesPerRow = (TERRAIN_OFFSETS_M.length - 1) * 6;
  const rowCount = Math.ceil(route.lengthM / 10);
  const apronRowCount = Math.ceil(route.lengthM / 2);
  const apronStepM = route.lengthM / apronRowCount;
  const position = offsetPosition(route, distanceM, lateralM);

  const ray = new THREE.Raycaster(
    new THREE.Vector3(position.x, position.y + 20, position.z),
    new THREE.Vector3(0, -1, 0),
  );

  const hits: THREE.Intersection[] = [];

  for (const { startM, endM } of alpineTerrainWindows(route, distanceM, nearbyM)) {
    const startRow = Math.floor(startM / 10);
    const endRow = Math.min(rowCount, Math.ceil(endM / 10));
    const apronStart = Math.floor(startM / apronStepM);
    const apronEnd = Math.min(apronRowCount, Math.ceil(endM / apronStepM));

    geometry.setDrawRange(startRow * indicesPerRow, (endRow - startRow) * indicesPerRow);
    apronGeometry.setDrawRange(apronStart * 6, (apronEnd - apronStart) * 6);
    hits.push(...ray.intersectObject(terrain));
  }

  return hits[0];
}

function assertAlpineShoulder(hit: AlpineHit | undefined, roadYM: number, label: string): void {
  if (hit === undefined) throw new Error(label);

  expect(hit.point.y).toBeLessThan(roadYM);
  expect(hit.point.y).toBeGreaterThan(roadYM - 0.6);
  expect(hit.face?.normal.y).toBeGreaterThan(0.9);
}

it("keeps alpine terrain offsets open after the rounded switchback", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, 42, false);
  const cornerCenter = route.worldPos(1500);
  const corner = terrainPosition(plan, 1500, 100);
  const straightCenter = route.worldPos(100);
  const straight = terrainPosition(plan, 100, 100);

  expect(Math.hypot(corner.x - cornerCenter.x, corner.z - cornerCenter.z)).toBeGreaterThan(90);
  expect(Math.hypot(straight.x - straightCenter.x, straight.z - straightCenter.z)).toBeGreaterThan(
    90,
  );
});

it("keeps both alpine road shoulders below the real road along the whole route", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, 42, false);
  const terrain = createTerrain(plan);
  const geometry = landGeometry(terrain);
  const apronGeometry = requiredApronGeometry(terrain);
  const rowCount = Math.ceil(route.lengthM / 10);
  const nearbyM = 170;

  terrain.updateMatrixWorld(true);

  for (let sample = 0; sample <= rowCount; sample += 1) {
    const distanceM = alpineSampleDistanceM(route, sample, rowCount);

    for (const lateralM of [-3.5, 3.5]) {
      const position = offsetPosition(route, distanceM, lateralM);

      const hit = alpineShoulderHit(
        terrain,
        geometry,
        apronGeometry,
        route,
        distanceM,
        lateralM,
        nearbyM,
      );

      expect(hit).toBeDefined();
      assertAlpineShoulder(hit, position.y, `d=${distanceM}, lateral=${lateralM}`);
    }
  }

  disposeObject(terrain);
});
