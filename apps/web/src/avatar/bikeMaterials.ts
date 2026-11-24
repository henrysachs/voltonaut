import * as THREE from "three";

import { mergeGeometries } from "./bikeMesh.js";
import { lerp } from "./bikeSweep.js";

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

let sharedEnvironment: THREE.DataTexture | undefined;

/** Sky/ground gradient with a soft sun spot; `elevation` is 0 at the nadir and 1 at the zenith. */
export function environmentTexel(
  elevation: number,
  azimuthRad: number,
): readonly [number, number, number] {
  const sun =
    Math.max(0, Math.cos(azimuthRad - 0.8)) ** 24 * Math.max(0, 1 - Math.abs(elevation - 0.72) * 6);

  const sky = elevation > 0.5;
  const horizon = Math.exp(-Math.abs(elevation - 0.5) * 12);
  const sky0 = sky ? [150, 185, 235] : [52, 60, 48];
  const sky1 = sky ? [215, 225, 235] : [150, 160, 150];

  return [
    Math.min(255, lerp(sky0[0] ?? 0, sky1[0] ?? 0, horizon) + sun * 120),
    Math.min(255, lerp(sky0[1] ?? 0, sky1[1] ?? 0, horizon) + sun * 110),
    Math.min(255, lerp(sky0[2] ?? 0, sky1[2] ?? 0, horizon) + sun * 90),
  ];
}

/**
 * Small procedural environment so lacquer and metal have something to reflect.
 * Deterministic, no download; three converts the equirect texture to PMREM on first use.
 */
export function bikeEnvironmentMap(): THREE.DataTexture {
  if (sharedEnvironment !== undefined) return sharedEnvironment;

  const width = 64;
  const height = 32;
  const texels = new Uint8Array(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const row = Math.floor(index / width);

    const color = environmentTexel(
      1 - (row + 0.5) / height,
      ((index % width) / width) * Math.PI * 2,
    );

    texels.set([color[0], color[1], color[2], 255], index * 4);
  }

  sharedEnvironment = new THREE.DataTexture(texels, width, height, THREE.RGBAFormat);
  sharedEnvironment.mapping = THREE.EquirectangularReflectionMapping;
  sharedEnvironment.colorSpace = THREE.SRGBColorSpace;
  sharedEnvironment.magFilter = THREE.LinearFilter;
  sharedEnvironment.needsUpdate = true;

  return sharedEnvironment;
}

function lacquer(
  color: number,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The shared environment texture is a Three object assigned by reference.
  environment: Readonly<THREE.Texture>,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.3,
    roughness: 0.36,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMap: environment,
    envMapIntensity: 0.85,
  });
}

/** One material set per bike; paint, decal, rim and sidewall are recoloured from the specs. */
export function createBikeMaterials(): BikeMaterialSet {
  const environment = bikeEnvironmentMap();

  const standard = (
    color: number,
    metalness: number,
    roughness: number,
  ): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      envMap: environment,
      envMapIntensity: 0.9,
    });

  const carbon = lacquer(0x16181b, environment);

  carbon.metalness = 0.15;
  carbon.roughness = 0.45;
  carbon.clearcoat = 0.7;
  carbon.clearcoatRoughness = 0.12;

  return {
    paint: lacquer(0xf0a83b, environment),
    accent: lacquer(0x15181b, environment),
    carbon,
    tape: standard(0x131416, 0, 0.82),
    rubber: standard(0x1b1b1c, 0, 0.9),
    sidewall: standard(0x1b1b1c, 0, 0.9),
    alloy: standard(0xc9ced2, 1, 0.26),
    drivetrain: standard(0x55595f, 0.95, 0.38),
    rim: standard(0xd3dadb, 0.85, 0.25),
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
