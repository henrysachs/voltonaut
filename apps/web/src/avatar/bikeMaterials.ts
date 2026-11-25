import * as THREE from "three";

import { mergeGeometries } from "./bikeMesh.js";

export type BikeMaterialKey =
  | "paint"
  | "accent"
  | "carbon"
  | "tape"
  | "rubber"
  | "sidewall"
  | "alloy"
  | "drivetrain"
  | "rim"
  | "bottle";

export type BikeMaterialSet = Readonly<Record<BikeMaterialKey, THREE.MeshStandardMaterial>>;

/** Looks up the shared material for a part; a function keeps builders free of mutable parameters. */
export type BikeMaterials = (key: BikeMaterialKey) => THREE.MeshStandardMaterial;

const SHADOW_KEYS: ReadonlySet<BikeMaterialKey> = new Set([
  "paint",
  "carbon",
  "rubber",
  "rim",
  "tape",
]);

/**
 * Clear-coated paint. No environment map on purpose: three converts one to PMREM on the
 * first frame, which cost ~0.8 s of startup on software GPUs (PR #105). Specular comes from
 * the scene's sun and hemisphere light instead.
 */
function lacquer(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.15,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
}

function standard(color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

/** One material set per bike; paint, decal, rim and sidewall are recoloured from the specs. */
export function createBikeMaterials(): BikeMaterialSet {
  const carbon = lacquer(0x16181b);

  carbon.roughness = 0.45;
  carbon.clearcoat = 0.7;
  carbon.clearcoatRoughness = 0.12;

  return {
    paint: lacquer(0xf0a83b),
    accent: lacquer(0x15181b),
    carbon,
    tape: standard(0x131416, 0, 0.82),
    rubber: standard(0x1b1b1c, 0, 0.9),
    sidewall: standard(0x1b1b1c, 0, 0.9),
    alloy: standard(0xc9ced2, 0.55, 0.32),
    drivetrain: standard(0x6a6f75, 0.5, 0.42),
    rim: standard(0xd3dadb, 0.55, 0.28),
    bottle: standard(0xdde5ea, 0, 0.38),
  };
}

export type BikeMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

const GROUP_MESHES = new WeakMap<THREE.Object3D, BikeMesh[]>();

/** Typed meshes that `PartBucket.build` attached to a group. */
export function bikeMeshesOf(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Used as identity key only.
  group: Readonly<THREE.Object3D>,
): readonly BikeMesh[] {
  return GROUP_MESHES.get(group) ?? [];
}

/** Collects geometry per material and turns every bucket into a single mesh (one draw call). */
export class PartBucket {
  private readonly parts = new Map<BikeMaterialKey, THREE.BufferGeometry[]>();

  add(
    key: BikeMaterialKey,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The bucket takes ownership of the temporary Three geometry and bakes the transform into it.
    geometry: THREE.BufferGeometry,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once here.
    matrix?: Readonly<THREE.Matrix4>,
  ): void {
    if (matrix !== undefined) geometry.applyMatrix4(matrix);

    const list = this.parts.get(key) ?? [];

    list.push(geometry);
    this.parts.set(key, list);
  }

  build(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The group receives the newly created meshes.
    target: THREE.Group,
    materials: BikeMaterials,
    prefix: string,
  ): void {
    for (const [key, geometries] of this.parts) {
      const mesh: BikeMesh = new THREE.Mesh(mergeGeometries(geometries), materials(key));

      mesh.name = `${prefix}-${key}`;
      mesh.castShadow = SHADOW_KEYS.has(key);
      target.add(mesh);
      GROUP_MESHES.set(target, [...bikeMeshesOf(target), mesh]);
    }

    this.parts.clear();
  }
}
