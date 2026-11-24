import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { AvatarConfigSchema } from "@voltonaut/shared";

import { createAvatarPreview } from "./customize.js";

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

describe("avatar preview model", () => {
  it("applies both jersey colors and varies the accent by design", () => {
    const preview = createAvatarPreview(2.105);

    try {
      const stripe = AvatarConfigSchema.parse({
        ...DEFAULT_AVATAR_CONFIG,
        rider: {
          ...DEFAULT_AVATAR_CONFIG.rider,
          jerseyId: "jersey.stripe",
          jerseyColors: ["#112233", "#445566"],
        },
      });

      preview.setLook(stripe);

      const primary = standardMaterial(meshByName(preview.root, "jersey-primary"));
      const accent = standardMaterial(meshByName(preview.root, "jersey-accent"));
      const stripeRadius = meshByName(preview.root, "jersey-accent").scale.x;
      expect(primary.color.getHexString()).toBe("112233");
      expect(accent.color.getHexString()).toBe("445566");
      expect(stripeRadius).toBe(0.158);

      preview.setLook({
        ...stripe,
        rider: { ...stripe.rider, jerseyId: "jersey.classic" },
      });
      expect(meshByName(preview.root, "jersey-accent").scale.x).toBe(0.152);
      expect(accent.roughness).toBe(0.85);
    } finally {
      preview.dispose();
    }
  });
});

describe("avatar preview pose", () => {
  it("initializes both shoes at the static preview pedals", () => {
    const preview = createAvatarPreview(2.105);

    try {
      const right = meshByName(preview.root, "shoe-right");
      const left = meshByName(preview.root, "shoe-left");
      expect(right.position.x).toBeCloseTo(-0.045);
      expect(right.position.y).toBeCloseTo(0.285);
      expect(right.position.z).toBeCloseTo(0.14);
      expect(left.position.x).toBeCloseTo(-0.045);
      expect(left.position.y).toBeCloseTo(0.625);
      expect(left.position.z).toBeCloseTo(-0.14);
    } finally {
      preview.dispose();
    }
  });
});
