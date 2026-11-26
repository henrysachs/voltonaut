/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only traverse them. */
import { ALPINE_PASS, COAST_LOOP, NIGHT_CITY, TEST_LOOP, createRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { biomeFromScenery } from "./biome.js";
import { createAlpineScenery, createCoastScenery, createNightCityScenery } from "./biomeScenery.js";
import { routeClearanceM, routeCorridorSamples } from "./biomeSceneryShared.js";
import { createLandscapeSystem } from "./landscape.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { createScheduler } from "./scheduler.js";
import { FOREST_TERRAIN, createTerrain } from "./terrain.js";

function instanceCount(root: Readonly<THREE.Object3D>): number {
  let count = 0;

  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) count += object.count;
  });

  return count;
}

function groundColor(group: Readonly<THREE.Group>): number {
  const mesh = group.children[0];

  if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
    return mesh.material.color.getHex();
  }

  throw new TypeError("the terrain group must own a ground mesh first");
}

function terrainPositions(group: Readonly<THREE.Group>): readonly number[] {
  const mesh = group.getObjectByName("route-terrain");

  if (mesh instanceof THREE.Mesh) {
    const geometry: unknown = mesh.geometry;

    if (geometry instanceof THREE.BufferGeometry) {
      const attribute: unknown = geometry.getAttribute("position");

      if (attribute instanceof THREE.BufferAttribute) {
        return Array.from(attribute.array);
      }
    }
  }

  throw new TypeError("route-terrain must own a position buffer attribute");
}

function seaPositionY(root: Readonly<THREE.Object3D>): number {
  const sea = root.getObjectByName("biome-sea");

  if (sea instanceof THREE.Mesh) {
    return sea.position.y;
  }

  throw new TypeError("coast scenery must own the named biome-sea mesh");
}

function basicMaterials(root: Readonly<THREE.Object3D>): readonly THREE.MeshBasicMaterial[] {
  const materials: THREE.MeshBasicMaterial[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      materials.push(object.material);
    }
  });

  return materials;
}

function instancePositions(root: Readonly<THREE.Object3D>): readonly THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];
  const matrix = new THREE.Matrix4();

  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, matrix);
        positions.push(new THREE.Vector3().setFromMatrixPosition(matrix));
      }
    }
  });

  return positions;
}

it("derives the discriminated biome from RouteData.scenery", () => {
  expect(biomeFromScenery("plain")).toEqual({ kind: "forest" });
  expect(biomeFromScenery("coast")).toEqual({ kind: "coast" });
  expect(biomeFromScenery("alpine")).toEqual({ kind: "alpine" });
  expect(biomeFromScenery("night-city")).toEqual({ kind: "night-city" });
  expect(biomeFromScenery("mars")).toEqual({ kind: "forest" });
});

it("keeps the forest terrain palette byte-identical to the original colors", () => {
  expect(FOREST_TERRAIN).toEqual({
    low: 0x466848,
    high: 0x72925a,
    shore: 0xc9bb8a,
    ground: 0x59744d,
  });
});

it("coast scenery spreads palms, the sea and one lighthouse deterministically", () => {
  const route = createRoute(COAST_LOOP);
  const plan = createLandscapePlan(route, 42, true);
  const first = createCoastScenery(plan);
  const second = createCoastScenery(plan);

  expect(first.name).toBe("biome-coast");
  expect(first.getObjectByName("biome-sea")).toBeInstanceOf(THREE.Mesh);
  expect(first.getObjectByName("biome-lighthouse")?.children).toHaveLength(3);
  expect(instanceCount(first)).toBe(instanceCount(second));
  expect(instanceCount(first)).toBeGreaterThan(300);
  expect(seaPositionY(first)).toBeLessThan(route.worldPos(0).y - 6);
});

it("alpine scenery keeps the serpentine flanks rocky, snowy and sparse", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, 42, false);
  const scenery = createAlpineScenery(plan);

  expect(scenery.name).toBe("biome-alpine");
  expect(scenery.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);
  expect(instanceCount(scenery)).toBeGreaterThan(400);

  // No lake was requested: the stand-in pond stays tiny and far off the road.
  expect(plan.lake.alongRadiusM).toBe(1);
  expect(plan.lake.acrossRadiusM).toBe(1);
});

it("keeps alpine rocks and pines off every road leg after the hairpins", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, 42, false);
  const scenery = createAlpineScenery(plan);
  const roadSamples = routeCorridorSamples(route);

  for (const position of instancePositions(scenery)) {
    expect(routeClearanceM(position, roadSamples)).toBeGreaterThanOrEqual(8);
  }
});

it("night city scenery wires streetlights and neon without real light sources", () => {
  const route = createRoute(NIGHT_CITY);
  const plan = createLandscapePlan(route, 42, false);
  const scenery = createNightCityScenery(plan);
  const glow = scenery.children.find((child) => child instanceof THREE.AmbientLight);

  expect(scenery.name).toBe("biome-night-city");
  expect(glow).toBeInstanceOf(THREE.AmbientLight);
  expect(instanceCount(scenery)).toBeGreaterThan(100);
  expect(basicMaterials(scenery).length).toBeGreaterThan(0);
});

it.each([TEST_LOOP, COAST_LOOP, ALPINE_PASS, NIGHT_CITY])(
  "the landscape system builds $id from its route and disposes it",
  (data) => {
    const scene = new THREE.Scene();

    const scheduler = createScheduler([createLandscapeSystem()], {
      scene,
      route: createRoute(data),
    });

    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBeInstanceOf(THREE.Group);
    scheduler.dispose();
    expect(scene.children).toHaveLength(0);
  },
);

it("terrain palettes color the ground per biome and keep the forest default identical", () => {
  const route = createRoute(NIGHT_CITY);
  const plan = createLandscapePlan(route, 42, false);
  const cityPalette = { low: 0x22262e, high: 0x303540, shore: 0x2a2e36, ground: 0x191c22 };
  const city = createTerrain(plan, cityPalette);
  const explicitForest = createTerrain(plan, FOREST_TERRAIN);
  const implicitForest = createTerrain(plan);

  expect(groundColor(city)).toBe(cityPalette.ground);
  expect(terrainPositions(explicitForest)).toEqual(terrainPositions(implicitForest));
});
