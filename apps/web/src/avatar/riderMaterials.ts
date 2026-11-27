import * as THREE from "three";

/**
 * Rider materials: one skinned mesh per key. Painted detail (jersey design, zip, seams, vents,
 * face, hair, shoe straps) lives in generated textures, so it costs no triangles and never
 * z-fights with the surface below.
 */
export type RiderMaterialKey = "kit" | "skin" | "sock" | "shoe" | "dark" | "helmet" | "lens";

export type RiderMaterialSet = Readonly<Record<RiderMaterialKey, THREE.MeshStandardMaterial>>;

/** Looks up the shared material for a part; a function keeps builders free of mutable parameters. */
export type RiderMaterials = (key: RiderMaterialKey) => THREE.MeshStandardMaterial;

function standard(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** One material set per rider; maps are attached by the texture painter. */
export function createRiderMaterials(): RiderMaterialSet {
  // Glossy like a painted shell; no environment map for the same startup reason as the bike (PR #105).
  const helmet = new THREE.MeshPhysicalMaterial({
    color: 0xf5ebca,
    roughness: 0.32,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
  });

  const lens = new THREE.MeshStandardMaterial({
    color: 0x18272e,
    roughness: 0.08,
    metalness: 0.6,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  return {
    kit: standard(0xffffff, 0.72),
    skin: standard(0xffffff, 0.58),
    sock: standard(0xf1efe8, 0.92),
    shoe: standard(0xffffff, 0.38),
    dark: standard(0x18191b, 0.66),
    helmet,
    lens,
  };
}
