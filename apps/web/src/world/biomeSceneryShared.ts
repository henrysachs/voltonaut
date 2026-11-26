import type { EngineRoute, WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import { terrainPosition, type LandscapePlan } from "./landscape-plan.js";

/** Decor instance routed to a chunk by its route distance, like forest plants. */
export interface ChunkItem {
  readonly routeDistanceM: number;
}

/** One instanced mesh per 250 m window keeps frustum and shadow culling sharp. */
export const CHUNK_M = 250;

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    return state / 4_294_967_296;
  };
}

export interface ChunkLayer<T extends ChunkItem> {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly items: readonly T[];
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three hands its mutable scene graph object to the layer writer.
  readonly transform: (item: Readonly<T>, object: THREE.Object3D) => void;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three hands its mutable color object to the layer writer.
  readonly tint: (item: Readonly<T>, color: THREE.Color) => void;
}

export function chunkedMeshes<T extends ChunkItem>(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The layer owns the Three resources it hands to the instancing helper.
  layer: ChunkLayer<T>,
  chunkSizeM = CHUNK_M,
): readonly THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  const object = new THREE.Object3D();
  const color = new THREE.Color();
  let totalM = 0;

  for (const item of layer.items) totalM = Math.max(totalM, item.routeDistanceM);

  for (let startM = 0; startM <= totalM; startM += chunkSizeM) {
    const chunk = layer.items.filter(
      (item) => item.routeDistanceM >= startM && item.routeDistanceM < startM + chunkSizeM,
    );

    if (chunk.length === 0) continue;

    const mesh = new THREE.InstancedMesh(layer.geometry, layer.material, chunk.length);

    for (const [index, item] of chunk.entries()) {
      layer.transform(item, object);
      object.updateMatrix();
      mesh.setMatrixAt(index, object.matrix);
      layer.tint(item, color);
      mesh.setColorAt(index, color);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }

  return meshes;
}

export function groundPosition(
  plan: Readonly<Pick<LandscapePlan, "route" | "terrain">>,
  distanceM: number,
  lateralM: number,
): WorldPos {
  return terrainPosition(plan, distanceM, lateralM);
}

/** Horizontal route samples used to keep decorations out of every road leg. */
export function routeCorridorSamples(
  route: Readonly<EngineRoute>,
  stepM = 10,
): readonly WorldPos[] {
  const count = Math.max(1, Math.ceil(route.lengthM / stepM));
  const samples: WorldPos[] = [];

  for (let index = 0; index < count; index += 1) {
    samples.push(route.worldPos((index / count) * route.lengthM));
  }

  return samples;
}

/** Horizontal distance to the nearest sampled road centerline point. */
export function routeClearanceM(
  position: Readonly<WorldPos>,
  samples: readonly WorldPos[],
): number {
  let clearanceM = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    clearanceM = Math.min(clearanceM, Math.hypot(position.x - sample.x, position.z - sample.z));
  }

  return clearanceM;
}

export interface RouteBounds {
  readonly centerX: number;
  readonly centerZ: number;
  readonly minY: number;
}

/** Bounds of the route centerline; sea and ambient glow anchor at its centre. */
export function routeBounds(plan: Readonly<Pick<LandscapePlan, "route">>): RouteBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  for (let distanceM = 0; distanceM <= plan.route.lengthM; distanceM += 50) {
    const position = plan.route.worldPos(Math.min(distanceM, plan.route.lengthM));

    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minZ = Math.min(minZ, position.z);
    maxZ = Math.max(maxZ, position.z);
    minY = Math.min(minY, position.y);
  }

  return { centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, minY };
}
