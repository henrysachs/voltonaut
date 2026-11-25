import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { DEFAULT_AVATAR_CONFIG, SEASON_AVATAR_ITEMS, START_AVATAR_CATALOG } from "@voltonaut/rules";
import { AvatarConfigSchema } from "@voltonaut/shared";

import { bikeGeometry } from "./bikeGeometry.js";
import { DEFAULT_FRAME_SPEC, DEFAULT_WHEEL_SPEC } from "./bikeSpecs.js";
import { createAvatarPreview } from "./customize.js";
import { legPose } from "./pose.js";
import { BIBS_START_S, COLLAR_S, KIT_ATLAS, panelS } from "./riderAtlas.js";

const AVATAR_ITEMS = [...START_AVATAR_CATALOG, ...SEASON_AVATAR_ITEMS];
const FRAME_ITEMS = AVATAR_ITEMS.filter((item) => item.slot === "frame");
const WHEEL_ITEMS = AVATAR_ITEMS.filter((item) => item.slot === "wheels");

function meshByName(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three owns the mutable scene graph inspected by this test helper.
  root: Readonly<THREE.Group>,
  name: string,
): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  root.traverse(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three invokes traversal with its mutable Object3D contract.
    (object) => {
      if (object instanceof THREE.Mesh && object.name === name) found = object;
    },
  );

  if (found === undefined) throw new Error(`Missing preview mesh: ${name}`);

  return found;
}

function standardMaterial(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three materials are mutable library objects inspected by this test helper.
  mesh: Readonly<THREE.Mesh>,
): THREE.MeshStandardMaterial {
  if (mesh.material instanceof THREE.MeshStandardMaterial) return mesh.material;

  throw new Error(`Missing standard material: ${mesh.name}`);
}

const PREVIEW_ITEMS = {
  jersey: "jersey.kom",
  helmet: "helmet.halo",
  glasses: "glasses.sport",
  shoes: "shoes.white",
} as const;

/** sRGB texel of a painted map at (u, v). */
function texel(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three materials are mutable library objects inspected by this test helper.
  material: THREE.MeshStandardMaterial,
  u: number,
  v: number,
): string {
  const map = material.map instanceof THREE.DataTexture ? material.map : undefined;

  if (map === undefined) throw new Error("Missing painted map");

  const { data, width, height } = map.image;

  if (data === null) throw new Error("Painted map without data");

  const offset = (Math.floor(v * height) * width + Math.floor(u * width)) * 4;
  const hex = (index: number): string => (data[offset + index] ?? 0).toString(16).padStart(2, "0");

  return `${hex(0)}${hex(1)}${hex(2)}`;
}

/** Texture v of a jersey panel height t (hem → collar) inside the torso band of the kit atlas. */
function jerseyV(t: number): number {
  return ((panelS(t) - BIBS_START_S) / (COLLAR_S - BIBS_START_S)) * KIT_ATLAS.torso[1];
}

describe("avatar preview model", () => {
  it("paints both jersey colours into the kit texture and the design decides where", () => {
    const preview = createAvatarPreview(2.105);

    try {
      const config = AvatarConfigSchema.parse({
        ...DEFAULT_AVATAR_CONFIG,
        rider: { ...DEFAULT_AVATAR_CONFIG.rider, jerseyColors: ["#112233", "#445566"] },
      });

      preview.setLook(config);

      const kit = standardMaterial(meshByName(preview.root, "rider-kit"));

      expect(texel(kit, 0.12, jerseyV(0.3))).toBe("112233");
      expect(texel(kit, 0.12, jerseyV(0.62))).toBe("445566");

      preview.setLook({ ...config, rider: { ...config.rider, jerseyId: "jersey.century" } });

      const century = standardMaterial(meshByName(preview.root, "rider-kit"));

      expect(texel(century, 0.12, jerseyV(0.62))).toBe("112233");
      expect(texel(century, 0.12, jerseyV(0.52))).toBe("445566");
    } finally {
      preview.dispose();
    }
  });

  it("colours the helmet shell and tints the skin texture", () => {
    const preview = createAvatarPreview(2.105);

    try {
      preview.setLook(
        AvatarConfigSchema.parse({
          ...DEFAULT_AVATAR_CONFIG,
          rider: { ...DEFAULT_AVATAR_CONFIG.rider, helmetColor: "#ff0000", skinTone: "#8d5524" },
        }),
      );

      expect(standardMaterial(meshByName(preview.root, "rider-helmet")).color.getHexString()).toBe(
        "ff0000",
      );
      expect(texel(standardMaterial(meshByName(preview.root, "rider-skin")), 0.5, 0.95)).toBe(
        "8d5524",
      );
    } finally {
      preview.dispose();
    }
  });
});

function triangleCount(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three geometries are mutable library objects only inspected here.
  geometry: Readonly<THREE.BufferGeometry>,
): number {
  return (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
}

function sceneTriangles(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three owns the mutable scene graph inspected by this test helper.
  root: Readonly<THREE.Group>,
): number {
  let count = 0;

  root.traverse(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three invokes traversal with its mutable Object3D contract.
    (object) => {
      if (object instanceof THREE.Mesh && object.visible) {
        const geometry: unknown = object.geometry;

        if (geometry instanceof THREE.BufferGeometry) count += triangleCount(geometry);
      }
    },
  );

  return count;
}

describe("avatar preview budget", () => {
  it("keeps rider and bike within the docs/04 §11 triangle budget for every bike with the heaviest kit", () => {
    const preview = createAvatarPreview(2.105);

    try {
      for (const frame of FRAME_ITEMS) {
        for (const wheels of WHEEL_ITEMS) {
          preview.setLook(
            AvatarConfigSchema.parse({
              ...DEFAULT_AVATAR_CONFIG,
              rider: {
                ...DEFAULT_AVATAR_CONFIG.rider,
                jerseyId: PREVIEW_ITEMS.jersey,
                helmetId: PREVIEW_ITEMS.helmet,
                glassesId: PREVIEW_ITEMS.glasses,
                shoesId: PREVIEW_ITEMS.shoes,
              },
              bike: { ...DEFAULT_AVATAR_CONFIG.bike, frameId: frame.id, wheelsId: wheels.id },
            }),
          );
          expect(sceneTriangles(preview.root)).toBeLessThanOrEqual(50_000);
        }
      }
    } finally {
      preview.dispose();
    }
  });
});

function bonePosition(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three owns the mutable scene graph inspected by this test helper.
  root: Readonly<THREE.Group>,
  name: string,
): THREE.Vector3 {
  const bone = root.getObjectByName(name);

  if (bone === undefined) throw new Error(`Missing bone ${name}`);

  return bone.getWorldPosition(new THREE.Vector3());
}

function footY(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three owns the mutable scene graph inspected by this test helper.
  root: Readonly<THREE.Group>,
  name: string,
): number {
  return bonePosition(root, name).y;
}

describe("avatar preview pose", () => {
  it("puts both feet on the opposed pedals of the preview crank", () => {
    const preview = createAvatarPreview(2.105);
    const geometry = bikeGeometry(2.105, DEFAULT_FRAME_SPEC, DEFAULT_WHEEL_SPEC);

    try {
      preview.root.updateMatrixWorld(true);

      for (const [name, side] of [
        ["RightFoot", 1],
        ["LeftFoot", -1],
      ] as const) {
        const ankle = legPose(geometry, Math.PI / 2, side).ankle;

        expect(
          bonePosition(preview.root, name).distanceTo(new THREE.Vector3(...ankle)),
        ).toBeLessThan(1e-6);
      }

      expect(footY(preview.root, "RightFoot") + 0.3).toBeLessThan(footY(preview.root, "LeftFoot"));
    } finally {
      preview.dispose();
    }
  });
});
