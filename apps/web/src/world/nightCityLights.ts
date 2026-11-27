/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D, Color and materials are mutable scene resources; these layers own the instances they write. */
import type { EngineRoute, WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import type { ChunkItem, ChunkLayer } from "./biomeSceneryShared.js";
import { sampleRoad, roadSampleDistances } from "./road-plan.js";

export const WINDOW_MATERIAL_NAME = "night-city-windows";
const LAMP_LIGHT_NAME = "night-city-lamp-light";
const NEON_MATERIAL_NAME = "night-city-neon";

/** Lamp heads, signs and tubes: one unit box, sized per instance. */
export interface NeonItem extends ChunkItem {
  /** Centre of the box. */
  readonly position: WorldPos;
  readonly rotationRad: number;
  readonly sizeM: Readonly<{ x: number; y: number; z: number }>;
  readonly hue: number;
  readonly saturation: number;
  /** Rec. 709 luminance of the tint; above BLOOM_THRESHOLD the item glows. */
  readonly luminance: number;
}

/** All neon of the city in one instanced layer: one draw call per CHUNK_M section. */
export function neonLayer(items: readonly NeonItem[]): ChunkLayer<NeonItem> {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

  material.name = NEON_MATERIAL_NAME;

  return {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material,
    items,
    transform(item, object) {
      object.position.set(item.position.x, item.position.y, item.position.z);
      object.rotation.set(0, item.rotationRad, 0);
      object.scale.set(item.sizeM.x, item.sizeM.y, item.sizeM.z);
    },
    tint(item, color) {
      color.setHSL(item.hue, item.saturation, 0.55);
      color.multiplyScalar(item.luminance / luminanceOf(color));
    },
  };
}

/** Rec. 709 luminance of a linear colour, as the bloom pass measures it. */
export function luminanceOf(color: Readonly<THREE.Color>): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

export interface StreetLamp {
  readonly routeDistanceM: number;
  /** +1 is right of the road. */
  readonly side: 1 | -1;
}

const POOL_HALF_LENGTH_M = 13;
const LAMP_LIGHT = new THREE.Color(0.2, 0.13, 0.06);

function poolLight(lamps: readonly StreetLamp[], distanceM: number, side: 1 | -1): number {
  let light = 0;

  for (const lamp of lamps) {
    const reach = 1 - ((lamp.routeDistanceM - distanceM) / POOL_HALF_LENGTH_M) ** 2;

    if (reach > 0) light = Math.max(light, reach * reach * (lamp.side === side ? 1 : 0.45));
  }

  return light;
}

interface LampLightGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly center: THREE.Vector3;
}

/** Ribbon over the road edges with the lamps' light as vertex colours. */
function lampLightGeometry(route: EngineRoute, lamps: readonly StreetLamp[]): LampLightGeometry {
  const samples = sampleRoad(route, 9);
  const distances = roadSampleDistances(route);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const [index, sample] of samples.entries()) {
    const distanceM = distances[index] ?? 0;

    for (const [edge, side] of [
      [sample.left, -1],
      [sample.right, 1],
    ] as const) {
      const light = poolLight(lamps, distanceM, side);

      positions.push(edge.x, edge.y, edge.z);
      colors.push(LAMP_LIGHT.r * light, LAMP_LIGHT.g * light, LAMP_LIGHT.b * light);
    }

    if (index > 0) {
      const start = index * 2;

      indices.push(start - 2, start - 1, start, start, start - 1, start + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();

  const center = geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();

  // Plain dressing meshes stand where their geometry is (lake, sea); region tests locate them so.
  geometry.translate(-center.x, -center.y, -center.z);

  return { geometry, center };
}

/** Street lighting as an additive vertex-coloured ribbon on the asphalt: one draw call for the whole road. */
export function createLampLight(route: EngineRoute, lamps: readonly StreetLamp[]): THREE.Mesh {
  const { geometry, center } = lampLightGeometry(route, lamps);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.Mesh(geometry, material);

  material.name = LAMP_LIGHT_NAME;
  mesh.name = LAMP_LIGHT_NAME;
  mesh.position.set(center.x, center.y + 0.02, center.z);

  return mesh;
}

/** Fader for the night-city lights under root, found once by name (0 day … 1 night); a no-op elsewhere. */
export function nightLightsOf(root: THREE.Object3D): (night: number) => void {
  const windows: THREE.MeshStandardMaterial[] = [];
  const neon: THREE.MeshBasicMaterial[] = [];
  const lampLight: THREE.MeshBasicMaterial[] = [];

  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.MeshStandardMaterial &&
      object.material.name === WINDOW_MATERIAL_NAME
    ) {
      windows.push(object.material);
    }

    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      if (object.material.name === NEON_MATERIAL_NAME) neon.push(object.material);

      if (object.material.name === LAMP_LIGHT_NAME) lampLight.push(object.material);
    }
  });

  return (night) => {
    for (const material of windows) material.emissiveIntensity = 0.12 + 0.88 * night;

    for (const material of neon) material.color.setScalar(0.3 + 0.7 * night);

    for (const material of lampLight) material.opacity = night;
  };
}
