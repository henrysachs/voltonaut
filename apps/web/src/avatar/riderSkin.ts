import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { hasArea } from "./bikeMesh.js";
import type { Point2 } from "./bikeSweep.js";
import type { RiderMaterialKey, RiderMaterials } from "./riderMaterials.js";
import { skinSlots, type Weigher } from "./riderWeights.js";

interface SkinPart {
  readonly geometry: THREE.BufferGeometry;
  readonly weigher: Weigher;
  /** Constant texture coordinate (a plain area of the atlas) replacing the part's own UVs. */
  readonly uv: Point2 | undefined;
}

export type RiderMesh = THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

const SHADOWLESS: ReadonlySet<RiderMaterialKey> = new Set(["lens"]);

/** Typed buffers of one merged skinned mesh. */
interface SkinBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly skinIndex: Uint16Array;
  readonly skinWeight: Float32Array;
  readonly indices: Uint32Array;
}

function allocate(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Reads (and completes the normals of) the temporary part geometries.
  parts: readonly SkinPart[],
): SkinBuffers {
  let vertexCount = 0;
  let indexCount = 0;

  for (const { geometry } of parts) {
    if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();

    const count = geometry.getAttribute("position").count;

    vertexCount += count;
    indexCount += geometry.index?.count ?? count;
  }

  return {
    positions: new Float32Array(vertexCount * 3),
    normals: new Float32Array(vertexCount * 3),
    uvs: new Float32Array(vertexCount * 2),
    skinIndex: new Uint16Array(vertexCount * 4),
    skinWeight: new Float32Array(vertexCount * 4),
    indices: new Uint32Array(indexCount),
  };
}

/** Writes the index entries of every triangle with area (hasArea); returns how many. */
function writeTriangles(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fills the typed buffers owned by the merge.
  buffers: SkinBuffers,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Reads the temporary Three geometry of the part.
  geometry: THREE.BufferGeometry,
  vertexOffset: number,
  indexOffset: number,
): number {
  const position = geometry.getAttribute("position");
  const { index } = geometry;
  const count = index?.count ?? position.count;
  let written = 0;

  for (let corner = 0; corner + 2 < count; corner += 3) {
    const [a, b, c] = [corner, corner + 1, corner + 2].map((at) =>
      index === null ? at : index.getX(at),
    );

    if (a === undefined || b === undefined || c === undefined || !hasArea(position, a, b, c)) {
      continue;
    }

    buffers.indices.set(
      [vertexOffset + a, vertexOffset + b, vertexOffset + c],
      indexOffset + written,
    );
    written += 3;
  }

  return written;
}

/** Copies one part into the buffers; skin weights are computed once per vertex. Returns the index entries written. */
function writePart(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Fills the typed buffers owned by the merge.
  buffers: SkinBuffers,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Reads the temporary Three geometry of the part.
  part: Readonly<SkinPart>,
  vertexOffset: number,
  indexOffset: number,
): number {
  const { geometry, weigher, uv } = part;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");

  const ownUv =
    uv === undefined && geometry.hasAttribute("uv") ? geometry.getAttribute("uv") : undefined;

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const at = vertexOffset + vertex;
    const point: Point3 = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
    const [bones, weights] = skinSlots(weigher(point));

    buffers.positions.set(point, at * 3);
    buffers.normals.set([normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)], at * 3);
    buffers.uvs.set(
      ownUv === undefined ? (uv ?? [0.5, 0.5]) : [ownUv.getX(vertex), ownUv.getY(vertex)],
      at * 2,
    );
    buffers.skinIndex.set(bones, at * 4);
    buffers.skinWeight.set(weights, at * 4);
  }

  return writeTriangles(buffers, geometry, vertexOffset, indexOffset);
}

/** Merges parts into one indexed skinned geometry and frees the part geometries. */
function mergeSkinned(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Consumes and disposes the temporary Three geometries of the parts.
  parts: readonly SkinPart[],
): THREE.BufferGeometry {
  const buffers = allocate(parts);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const part of parts) {
    indexOffset += writePart(buffers, part, vertexOffset, indexOffset);
    vertexOffset += part.geometry.getAttribute("position").count;
    part.geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();

  merged.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(buffers.uvs, 2));
  merged.setAttribute("skinIndex", new THREE.BufferAttribute(buffers.skinIndex, 4));
  merged.setAttribute("skinWeight", new THREE.BufferAttribute(buffers.skinWeight, 4));
  merged.setIndex(new THREE.BufferAttribute(buffers.indices.slice(0, indexOffset), 1));

  return merged;
}

/** Collects skinned geometry per material and turns every bucket into one skinned mesh. */
export class SkinBucket {
  private readonly parts = new Map<RiderMaterialKey, SkinPart[]>();

  add(
    key: RiderMaterialKey,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The bucket takes ownership of the temporary Three geometry and bakes the transform into it.
    geometry: THREE.BufferGeometry,
    weigher: Weigher,
    uv?: Point2,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once here.
    matrix?: Readonly<THREE.Matrix4>,
  ): void {
    if (matrix !== undefined) geometry.applyMatrix4(matrix);

    const list = this.parts.get(key) ?? [];

    list.push({ geometry, weigher, uv });
    this.parts.set(key, list);
  }

  build(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The skeleton is shared by every skinned mesh of the rider.
    skeleton: THREE.Skeleton,
    materials: RiderMaterials,
  ): RiderMesh[] {
    const meshes: RiderMesh[] = [];

    for (const [key, parts] of this.parts) {
      const merged = mergeSkinned(parts);
      const mesh: RiderMesh = new THREE.SkinnedMesh(merged, materials(key));

      mesh.name = `rider-${key}`;
      mesh.castShadow = !SHADOWLESS.has(key);
      // Skinned bounds follow the pose; the rider is always near the camera anyway.
      mesh.frustumCulled = false;
      mesh.bind(skeleton, new THREE.Matrix4());
      meshes.push(mesh);
    }

    this.parts.clear();

    return meshes;
  }
}
