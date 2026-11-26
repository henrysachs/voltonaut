import { ALPINE_PASS, createRoute, TEST_LOOP } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createLandscapeSystem } from "./landscape.js";
import {
  createLandscapePlan,
  lakeRadius,
  offsetPosition,
  TERRAIN_OFFSETS_M,
  terrainPosition,
} from "./landscape-plan.js";
import { createScheduler } from "./scheduler.js";
import { createTerrain } from "./terrain.js";
import { disposeObject } from "./resources.js";

const route = createRoute(TEST_LOOP);
const plan = createLandscapePlan(route);

const roadSamples = [0, 10, 110, 180, 2999, 3000, 4200, 5000, 5600, 6600, 8000, 9999].map(
  (distanceM) => ({ distanceM, rowCount: distanceM === 0 ? Infinity : 3 }),
);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test reads the geometry owned by this mutable Three group.
function landGeometry(terrain: Readonly<THREE.Group>): Pick<THREE.BufferGeometry, "setDrawRange"> {
  const mesh = terrain.getObjectByName("route-terrain");

  if (mesh instanceof THREE.Mesh && mesh.geometry instanceof THREE.BufferGeometry) {
    return mesh.geometry;
  }

  throw new Error("The terrain system must own a named terrain mesh");
}

interface DisposalResource {
  readonly addEventListener: (type: "dispose", listener: () => void) => void;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test observes the real mutable Three scene graph.
function collectResources(scene: Readonly<THREE.Scene>): ReadonlySet<DisposalResource> {
  const resources = new Set<DisposalResource>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene object contract.
  scene.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.geometry instanceof THREE.BufferGeometry &&
      object.material instanceof THREE.Material
    ) {
      resources.add(object.geometry);
      resources.add(object.material);
    }

    if (object instanceof THREE.InstancedMesh) {
      resources.add(object);
    }
  });

  return resources;
}

it("repeats the same original forest for the same seed and varies placement for another seed", () => {
  expect(createLandscapePlan(route)).toEqual(plan);
  expect(createLandscapePlan(route, 43).trees).not.toEqual(plan.trees);
  expect(plan.trees.length).toBeGreaterThan(1000);
  expect(plan.trees.filter((plant) => plant.routeDistanceM < 400).length).toBeGreaterThan(50);
});

it("keeps full tree crowns and rocks off the actual asphalt and outside the lake", () => {
  const centerline = Array.from({ length: 1000 }, (_, index) => route.worldPos(index * 10));

  for (const plant of [...plan.trees, ...plan.rocks]) {
    const distanceM = Math.min(
      ...centerline.map((point) =>
        Math.hypot(point.x - plant.position.x, point.z - plant.position.z),
      ),
    );

    expect(distanceM - plant.radiusM).toBeGreaterThan(7);
    expect(lakeRadius(plan.lake, plant.position)).toBeGreaterThanOrEqual(1.2);
    expect(plant.routeDistanceM).toBeLessThan(route.lengthM);
  }
});

it("joins both road shoulders across the whole elevation profile and has relief outside them", () => {
  let maxReliefM = 0;

  for (let distanceM = 0; distanceM <= route.lengthM; distanceM += 10) {
    for (const lateralM of [-4, 0, 4]) {
      expect(terrainPosition(plan, distanceM, lateralM).y).toBeCloseTo(
        route.worldPos(distanceM).y - 0.06,
        8,
      );
    }

    const outside = terrainPosition(plan, distanceM, -70);

    maxReliefM = Math.max(maxReliefM, Math.abs(outside.y - route.worldPos(distanceM).y));
  }

  expect(maxReliefM).toBeGreaterThan(8);
  expect(terrainPosition(plan, 0, 4)).toEqual(terrainPosition(plan, route.lengthM, 4));
});

it("pinches alpine terrain offsets at hairpins instead of crossing the previous leg", () => {
  const alpineRoute = createRoute(ALPINE_PASS);
  const alpinePlan = createLandscapePlan(alpineRoute, 42, false);
  const cornerCenter = alpineRoute.worldPos(1500);
  const corner = terrainPosition(alpinePlan, 1500, 100);
  const straightCenter = alpineRoute.worldPos(100);
  const straight = terrainPosition(alpinePlan, 100, 100);

  expect(Math.hypot(corner.x - cornerCenter.x, corner.z - cornerCenter.z)).toBeLessThan(20);
  expect(corner.y).toBeLessThanOrEqual(cornerCenter.y);
  expect(Math.hypot(straight.x - straightCenter.x, straight.z - straightCenter.z)).toBeGreaterThan(
    90,
  );
});

it("builds upward-facing bounded terrain which supports the real road at climbs and the loop seam", () => {
  const terrain = createTerrain(plan);
  const geometry = landGeometry(terrain);
  const indicesPerRow = (TERRAIN_OFFSETS_M.length - 1) * 6;

  terrain.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();

  for (const { distanceM, rowCount } of roadSamples) {
    const row = Math.floor(distanceM / 10);

    geometry.setDrawRange(Math.max(0, row - 1) * indicesPerRow, indicesPerRow * rowCount);

    for (const lateralM of [-3.5, 0, 3.5]) {
      const position = offsetPosition(route, distanceM, lateralM);

      ray.set(
        new THREE.Vector3(position.x, position.y + 20, position.z),
        new THREE.Vector3(0, -1, 0),
      );
      const hit = ray.intersectObject(terrain)[0];

      expect(hit).toBeDefined();
      expect(hit?.point.y).toBeLessThan(position.y);
      expect(hit?.point.y).toBeGreaterThan(position.y - 0.2);
      expect(hit?.face?.normal.y).toBeGreaterThan(0.9);
    }
  }

  const bounds = new THREE.Box3().setFromObject(terrain);

  expect(bounds.max.x - bounds.min.x).toBeLessThan(4000);
  expect(bounds.max.z - bounds.min.z).toBeLessThan(4000);
  expect(bounds.max.y).toBeLessThan(210);
  expect(bounds.min.y).toBeGreaterThan(90);
  disposeObject(terrain);
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

it("roots tree trunks in the actual triangulated terrain instead of floating above it", () => {
  const terrain = createTerrain(plan);
  const ray = new THREE.Raycaster();
  const geometry = landGeometry(terrain);
  const indicesPerRow = (TERRAIN_OFFSETS_M.length - 1) * 6;

  terrain.updateMatrixWorld(true);

  for (const plant of plan.trees) {
    const row = Math.floor(plant.routeDistanceM / 10);

    geometry.setDrawRange(Math.max(0, row - 1) * indicesPerRow, indicesPerRow * 3);
    ray.set(
      new THREE.Vector3(plant.position.x, plant.position.y + 20, plant.position.z),
      new THREE.Vector3(0, -1, 0),
    );
    const hit = ray.intersectObject(terrain)[0];

    expect(hit).toBeDefined();
    expect(hit?.point.y).toBeCloseTo(plant.position.y, 1);
  }

  disposeObject(terrain);
});

it("releases every shared geometry, material and instance buffer once without touching another owner", () => {
  const scene = new THREE.Scene();
  const unrelated = new THREE.Group();

  scene.add(unrelated);
  const scheduler = createScheduler([createLandscapeSystem()], { scene, route });
  const resources = collectResources(scene);

  const counts = Array.from(resources, (resource) => {
    let count = 0;

    resource.addEventListener("dispose", () => {
      count += 1;
    });

    return () => count;
  });

  expect(resources.size).toBeGreaterThan(100);
  scheduler.dispose();
  scheduler.dispose();
  expect(counts.map((count) => count())).toEqual(counts.map(() => 1));
  expect(scene.children).toEqual([unrelated]);
});
