/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only traverse them. */
import { ALPINE_PASS, COAST_LOOP, NIGHT_CITY, createRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { biomeFromScenery } from "./biome.js";
import { createAlpineScenery, createCoastScenery, createNightCityScenery } from "./biomeScenery.js";
import { routeClearanceM, routeCorridorSamples } from "./biomeSceneryShared.js";
import { createLandscapePlan, type LandscapePlan } from "./landscape-plan.js";
import { createTerrainGeometries } from "./terrain.js";
import { FOREST_TERRAIN, type TerrainPalette } from "./terrain-shades.js";

function instanceCount(root: Readonly<THREE.Object3D>): number {
  let count = 0;

  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) count += object.count;
  });

  return count;
}

/** Vertex colours of every terrain chunk as [r, g, b, …]. */
function terrainColors(
  plan: Readonly<LandscapePlan>,
  palette: Readonly<TerrainPalette>,
): readonly number[] {
  return createTerrainGeometries(plan, palette).flatMap((geometry) => {
    const colors = Array.from(geometry.getAttribute("color").array);

    geometry.dispose();

    return colors;
  });
}

/** Colour channels of the raster outside the palette's low–high range (no lake, no shore). */
function colorsOutside(
  plan: Readonly<LandscapePlan>,
  palette: Readonly<TerrainPalette>,
): readonly number[] {
  const bounds = channelBounds(palette);

  return terrainColors(plan, palette).filter((value, index) => {
    const [low = 0, high = 0] = bounds[index % 3] ?? [];

    return value < low - 1e-6 || value > high + 1e-6;
  });
}

/** Linear channel bounds between the palette's low and high colours. */
function channelBounds(palette: Readonly<TerrainPalette>): readonly (readonly [number, number])[] {
  const low = new THREE.Color(palette.low);
  const high = new THREE.Color(palette.high);

  return [
    [Math.min(low.r, high.r), Math.max(low.r, high.r)],
    [Math.min(low.g, high.g), Math.max(low.g, high.g)],
    [Math.min(low.b, high.b), Math.max(low.b, high.b)],
  ];
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

function lightsIn(root: Readonly<THREE.Object3D>): readonly THREE.Light[] {
  const lights: THREE.Light[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Light) lights.push(object);
  });

  return lights;
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
  const plan = createLandscapePlan(route, [route], 42, true);
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
  const plan = createLandscapePlan(route, [route], 42, false);
  const scenery = createAlpineScenery(plan);

  expect(scenery.name).toBe("biome-alpine");
  expect(scenery.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);
  expect(scenery.children.length).toBeLessThanOrEqual(140);
  expect(instanceCount(scenery)).toBeGreaterThan(400);

  // No lake was requested: the stand-in pond stays tiny and far off the road.
  expect(plan.lake.alongRadiusM).toBe(1);
  expect(plan.lake.acrossRadiusM).toBe(1);
});

it("keeps alpine rocks and pines off every road leg after the hairpins", () => {
  const route = createRoute(ALPINE_PASS);
  const plan = createLandscapePlan(route, [route], 42, false);
  const scenery = createAlpineScenery(plan);
  const roadSamples = routeCorridorSamples(route);

  for (const position of instancePositions(scenery)) {
    expect(routeClearanceM(position, roadSamples)).toBeGreaterThanOrEqual(8);
  }
});

it("night city scenery wires streetlights and neon without real light sources", () => {
  const route = createRoute(NIGHT_CITY);
  const plan = createLandscapePlan(route, [route], 42, false);
  const scenery = createNightCityScenery(plan);

  expect(scenery.name).toBe("biome-night-city");
  expect(lightsIn(scenery)).toEqual([]);
  expect(instanceCount(scenery)).toBeGreaterThan(100);
  expect(basicMaterials(scenery).length).toBeGreaterThan(0);
});

it("terrain palettes color the raster per biome", () => {
  const route = createRoute(NIGHT_CITY);
  const plan = createLandscapePlan(route, [route], 42, false);
  const cityPalette = { low: 0x22262e, high: 0x303540, shore: 0x2a2e36, ground: 0x191c22 };

  expect(colorsOutside(plan, cityPalette)).toEqual([]);
  expect(terrainColors(plan, FOREST_TERRAIN)).not.toEqual(terrainColors(plan, cityPalette));
});
