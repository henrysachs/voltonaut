import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { AvatarConfigSchema } from "@voltonaut/shared";

import { bikeGeometry, pedalPoint } from "./bikeGeometry.js";
import { DEFAULT_FRAME_SPEC, DEFAULT_WHEEL_SPEC } from "./bikeSpecs.js";
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
  it("puts both shoes on the opposed pedals of the preview crank", () => {
    const preview = createAvatarPreview(2.105);
    const geometry = bikeGeometry(2.105, DEFAULT_FRAME_SPEC, DEFAULT_WHEEL_SPEC);

    try {
      for (const [name, side] of [
        ["shoe-right", 1],
        ["shoe-left", -1],
      ] as const) {
        const shoe = meshByName(preview.root, name);
        const pedal = pedalPoint(geometry, Math.PI / 2, side);

        expect(Math.abs(shoe.position.x - pedal[0])).toBeLessThan(0.05);
        expect(shoe.position.y - pedal[1]).toBeGreaterThan(0.015);
        expect(shoe.position.y - pedal[1]).toBeLessThan(0.06);
        expect(Math.sign(shoe.position.z)).toBe(side);
      }

      expect(meshByName(preview.root, "shoe-right").position.y).toBeLessThan(
        meshByName(preview.root, "shoe-left").position.y - 0.3,
      );
    } finally {
      preview.dispose();
    }
  });
});
