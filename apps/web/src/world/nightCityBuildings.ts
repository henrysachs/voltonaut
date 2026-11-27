/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D, Color and textures are mutable scene resources; these layers own the instances they write. */
import type { WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import {
  groundPosition,
  routeClearanceM,
  routeCorridorSamples,
  type ChunkItem,
  type ChunkLayer,
} from "./biomeSceneryShared.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { WINDOW_MATERIAL_NAME } from "./nightCityLights.js";

/** The only neon hues of the city. */
export const NEON = { cyan: 0.5, magenta: 0.87, amber: 0.11 } as const;
export const NEON_HUES: readonly number[] = Object.values(NEON);

/** Every building is this one box, sunk until heightM shows above ground (heightM ≤ this). */
export const TOWER_HEIGHT_M = 120;
const TOWER_DEPTH_M = 15;
const TOWER_FRONTAGE_M = 15;
const WINDOW_M = 3;
const FLOOR_M = 3.5;

/** Minimum distance from a building centre to any road leg. */
export const BUILDING_CLEARANCE_M = 20;

const WINDOW_CELLS_PER_SIDE = 16;
const CELL_TEXELS = 4;

interface RowSpec {
  readonly facadeLateralM: number;
  readonly spacingM: number;
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly neonTubes: boolean;
}

/** The near row forms the street wall, the far row the skyline behind it. */
const ROWS: readonly RowSpec[] = [
  { facadeLateralM: 13, spacingM: 20, minHeightM: 22, maxHeightM: 70, neonTubes: true },
  { facadeLateralM: 44, spacingM: 30, minHeightM: 55, maxHeightM: 118, neonTubes: false },
];

export interface BuildingItem extends ChunkItem {
  readonly position: WorldPos;
  readonly rotationRad: number;
  readonly heightM: number;
  readonly frontageM: number;
  readonly shade: number;
}

export interface NeonTubeItem extends ChunkItem {
  readonly position: WorldPos;
  readonly heightM: number;
  readonly hue: number;
}

export interface BuildingPlan {
  readonly buildings: readonly BuildingItem[];
  readonly tubes: readonly NeonTubeItem[];
}

interface Placement {
  readonly building: BuildingItem;
  readonly tube: NeonTubeItem | undefined;
}

function neonHueOf(roll: number): number {
  return NEON_HUES[Math.floor(roll * NEON_HUES.length) % NEON_HUES.length] ?? NEON.cyan;
}

function placeBuilding(
  plan: Readonly<LandscapePlan>,
  row: Readonly<RowSpec>,
  side: 1 | -1,
  distanceM: number,
  samples: readonly WorldPos[],
  random: () => number,
): Placement | undefined {
  const gap = random() < 0.07;
  const jitterM = random() * 3;
  const heightM = row.minHeightM + random() * (row.maxHeightM - row.minHeightM);
  const frontageM = TOWER_FRONTAGE_M * (0.85 + random() * 0.45);
  const tubeRoll = random();
  const shade = random();
  const facadeM = row.facadeLateralM + jitterM;

  const position = groundPosition(plan, distanceM, side * (facadeM + TOWER_DEPTH_M / 2));

  if (gap || routeClearanceM(position, samples) < BUILDING_CLEARANCE_M) return undefined;

  const hasTube = row.neonTubes && tubeRoll < 0.4;

  return {
    building: {
      routeDistanceM: distanceM,
      position,
      rotationRad: -plan.route.headingRad(distanceM),
      heightM,
      frontageM,
      shade,
    },
    tube: hasTube
      ? {
          routeDistanceM: distanceM,
          position: groundPosition(plan, distanceM, side * (facadeM - 0.4)),
          heightM: 6 + tubeRoll * 30,
          hue: neonHueOf(shade),
        }
      : undefined,
  };
}

/** Deterministic urban canyon: towers on both sides, kept off every road leg. */
export function planBuildings(plan: Readonly<LandscapePlan>, random: () => number): BuildingPlan {
  const samples = routeCorridorSamples(plan.route);
  const buildings: BuildingItem[] = [];
  const tubes: NeonTubeItem[] = [];

  for (const row of ROWS) {
    for (const side of [1, -1] as const) {
      let distanceM = random() * row.spacingM;

      while (distanceM < plan.route.lengthM) {
        const placement = placeBuilding(plan, row, side, distanceM, samples, random);

        if (placement !== undefined) buildings.push(placement.building);

        if (placement?.tube !== undefined) tubes.push(placement.tube);

        distanceM += row.spacingM * (0.85 + random() * 0.3);
      }
    }
  }

  return { buildings, tubes };
}

/** Warm and cool office light with rare neon-tinted rooms. */
const LIT_WINDOW_SRGB: readonly (readonly [number, number, number])[] = [
  [255, 214, 160],
  [255, 214, 160],
  [255, 196, 130],
  [196, 222, 255],
  [196, 222, 255],
  [80, 230, 255],
  [255, 90, 210],
];

const DARK_GLASS_SRGB: readonly [number, number, number] = [14, 18, 30];

/** Lit and dark windows in frames; FRAME_UV samples a frame texel. */
export function createWindowTexture(random: () => number): THREE.DataTexture {
  const size = WINDOW_CELLS_PER_SIDE * CELL_TEXELS;
  const data = new Uint8Array(size * size * 4);

  for (let cell = 0; cell < WINDOW_CELLS_PER_SIDE ** 2; cell += 1) {
    const lit = random() < 0.34;
    const tone = LIT_WINDOW_SRGB[Math.floor(random() * LIT_WINDOW_SRGB.length)] ?? DARK_GLASS_SRGB;
    const dim = 0.45 + random() * 0.55;
    const color = lit ? tone.map((channel) => Math.round(channel * dim)) : DARK_GLASS_SRGB;
    const cellX = (cell % WINDOW_CELLS_PER_SIDE) * CELL_TEXELS;
    const cellY = Math.floor(cell / WINDOW_CELLS_PER_SIDE) * CELL_TEXELS;

    for (let y = 1; y <= 2; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        const index = ((cellY + y) * size + cellX + x) * 4;

        data[index] = color[0] ?? 0;
        data[index + 1] = color[1] ?? 0;
        data[index + 2] = color[2] ?? 0;
      }
    }
  }

  for (let index = 3; index < data.length; index += 4) data[index] = 255;

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
}

/** UV of a frame texel (texel 0, 0): roofs and floors show no windows. */
export const FRAME_UV = 0.5 / (WINDOW_CELLS_PER_SIDE * CELL_TEXELS);

/** The shared tower: top at y = 0, a whole number of window cells on every side face. */
export function createBuildingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(TOWER_FRONTAGE_M, TOWER_HEIGHT_M, TOWER_DEPTH_M);
  const uv = geometry.getAttribute("uv");
  const normal = geometry.getAttribute("normal");
  const columns = TOWER_FRONTAGE_M / WINDOW_M;
  const rows = Math.round(TOWER_HEIGHT_M / FLOOR_M);

  geometry.translate(0, -TOWER_HEIGHT_M / 2, 0);

  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    if (normal.getY(vertex) === 0) {
      uv.setXY(
        vertex,
        (uv.getX(vertex) * columns) / WINDOW_CELLS_PER_SIDE,
        (uv.getY(vertex) * rows) / WINDOW_CELLS_PER_SIDE,
      );
    } else {
      uv.setXY(vertex, FRAME_UV, FRAME_UV);
    }
  }

  uv.needsUpdate = true;

  return geometry;
}

export function createWindowMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.1,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 1,
  });

  material.name = WINDOW_MATERIAL_NAME;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
#if defined( USE_INSTANCING ) && defined( USE_EMISSIVEMAP )
  // Each tower starts at its own window cell, so neighbours show different facades.
  vec2 towerSeed = instanceMatrix[3].xz;
  vEmissiveMapUv += floor(fract(sin(towerSeed * vec2(12.9898, 78.233)) * 43758.5453) * ${WINDOW_CELLS_PER_SIDE}.0) / ${WINDOW_CELLS_PER_SIDE}.0;
#endif`,
    );
  };

  return material;
}

export function buildingLayer(
  items: readonly BuildingItem[],
  random: () => number,
): ChunkLayer<BuildingItem> {
  return {
    geometry: createBuildingGeometry(),
    material: createWindowMaterial(createWindowTexture(random)),
    items,
    transform(building, object) {
      object.position.set(
        building.position.x,
        building.position.y + building.heightM,
        building.position.z,
      );
      object.rotation.set(0, building.rotationRad, 0);
      object.scale.set(building.frontageM / TOWER_FRONTAGE_M, 1, 1);
    },
    tint(building, color) {
      color.setHSL(0.63, 0.3, 0.06 + building.shade * 0.06);
    },
  };
}
