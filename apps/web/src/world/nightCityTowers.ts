/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D, Color and textures are mutable scene resources; these layers own the instances they write. */
import * as THREE from "three";

import type { ChunkLayer } from "./biomeSceneryShared.js";
import { TOWER_DEPTH_M, TOWER_FRONTAGE_M, type BuildingItem } from "./nightCityBuildings.js";
import { WINDOW_MATERIAL_NAME } from "./nightCityLights.js";

/**
 * Height of the shared box before scaling. Close to real tower heights on purpose: Three sizes
 * an instance's bounding sphere by its largest scale, so a 1 m box scaled to 100 m would never
 * be culled.
 */
const REFERENCE_HEIGHT_M = 100;
const WINDOW_M = 3;
const FLOOR_M = 3.5;
const WINDOW_CELLS_PER_SIDE = 16;
const CELL_TEXELS = 4;

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
function createWindowTexture(random: () => number): THREE.DataTexture {
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
const FRAME_UV = 0.5 / (WINDOW_CELLS_PER_SIDE * CELL_TEXELS);

/**
 * The shared tower with its base at y = 0, scaled to each tower's height. Side faces count whole
 * window cells across; the vertex shader counts floors up from the tower's height.
 */
function createBuildingGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(TOWER_FRONTAGE_M, REFERENCE_HEIGHT_M, TOWER_DEPTH_M);
  const uv = geometry.getAttribute("uv");
  const normal = geometry.getAttribute("normal");
  const columns = TOWER_FRONTAGE_M / WINDOW_M;

  geometry.translate(0, REFERENCE_HEIGHT_M / 2, 0);

  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    if (normal.getY(vertex) === 0) {
      uv.setXY(vertex, (uv.getX(vertex) * columns) / WINDOW_CELLS_PER_SIDE, uv.getY(vertex));
    } else {
      uv.setXY(vertex, FRAME_UV, FRAME_UV);
    }
  }

  uv.needsUpdate = true;

  return geometry;
}

function createWindowMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
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
  if ( abs( normal.y ) < 0.5 ) {
    vEmissiveMapUv.y = uv.y * length( instanceMatrix[ 1 ].xyz ) / ${((FLOOR_M * WINDOW_CELLS_PER_SIDE) / REFERENCE_HEIGHT_M).toFixed(4)};
  }
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
      object.position.set(building.position.x, building.position.y, building.position.z);
      object.rotation.set(0, building.rotationRad, 0);
      object.scale.set(
        building.frontageM / TOWER_FRONTAGE_M,
        building.heightM / REFERENCE_HEIGHT_M,
        1,
      );
    },
    tint(building, color) {
      color.setHSL(0.63, 0.3, 0.06 + building.shade * 0.06);
    },
  };
}
