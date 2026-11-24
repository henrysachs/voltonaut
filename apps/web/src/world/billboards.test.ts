import { createRoute, TEST_LOOP } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import {
  MOTIF_BORDER,
  MOTIF_HEIGHT_PX,
  MOTIF_VARIANT_BACKGROUNDS,
  MOTIF_WIDTH_PX,
  paintPlaceholderAtlas,
} from "./billboard-motif.js";
import { BILLBOARD_VARIANTS, planBillboards } from "./billboard-plan.js";
import { createBillboards, withVariantUv } from "./billboards.js";
import { createLandscapeSystem } from "./landscape.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { createScheduler } from "./scheduler.js";

const loop = createRoute(TEST_LOOP);
const boards = planBillboards(createLandscapePlan(loop)).billboards;
const ATLAS_WIDTH_PX = MOTIF_WIDTH_PX * BILLBOARD_VARIANTS;

function meshes(): readonly THREE.InstancedMesh[] {
  const root = createBillboards(boards);

  return ["billboard-structure", "billboard-faces"].flatMap((name) => {
    const mesh = root.getObjectByName(name);

    return mesh instanceof THREE.InstancedMesh ? [mesh] : [];
  });
}

function faces(): THREE.InstancedMesh {
  const [, face] = meshes();

  if (face !== undefined && face.material instanceof THREE.MeshStandardMaterial) return face;

  throw new Error("billboards need a textured face mesh");
}

function faceMaterial(): THREE.MeshStandardMaterial {
  const { material } = faces();

  if (material instanceof THREE.MeshStandardMaterial) return material;

  throw new Error("billboard faces need a standard material");
}

function atlasSize(): readonly number[] {
  const map = faceMaterial().map;

  if (map instanceof THREE.DataTexture) {
    const image: { readonly width: number; readonly height: number } = map.image;

    return [image.width, image.height];
  }

  throw new Error("billboard faces need the motif atlas");
}

function variantAttribute(): readonly number[] {
  const attribute = faces().geometry.getAttribute("instanceVariant");

  return Array.from({ length: attribute.count }, (_, index) => attribute.getX(index));
}

function atlasPixel(xPx: number, yPx: number): readonly number[] {
  const offset = (yPx * ATLAS_WIDTH_PX + xPx) * 4;

  return [...paintPlaceholderAtlas().subarray(offset, offset + 3)];
}

it("draws all billboards with two instanced meshes that cast no shadows", () => {
  const rows: (readonly [number, boolean])[] = [];

  for (const mesh of meshes()) rows.push([mesh.count, mesh.castShadow]);

  expect(rows).toEqual([
    [boards.length * 3, false],
    [boards.length, false],
  ]);
});

it("gives every face its route-order motif variant", () => {
  expect(variantAttribute()).toEqual(boards.map((board) => board.variant));
});

it("shifts the map UV per instance into its atlas cell", () => {
  const patched = withVariantUv("#include <common>\n#include <uv_vertex>");

  expect(patched).toContain("attribute float instanceVariant;");
  expect(patched).toContain(`vMapUv.x = ( vMapUv.x + instanceVariant ) / ${BILLBOARD_VARIANTS}.0;`);
  expect(Object.hasOwn(faceMaterial(), "onBeforeCompile")).toBe(true);
});

it("keeps the atlas within budget and releases it with its material", () => {
  const material = faceMaterial();
  let released = false;

  expect(atlasSize()).toEqual([ATLAS_WIDTH_PX, MOTIF_HEIGHT_PX]);
  expect(ATLAS_WIDTH_PX).toBeLessThanOrEqual(2048);
  material.map?.addEventListener("dispose", () => {
    released = true;
  });
  material.dispose();
  expect(released).toBe(true);
});

it("paints distinct, bordered placeholder motifs per atlas cell", () => {
  const middle = MOTIF_HEIGHT_PX / 2;

  expect(paintPlaceholderAtlas()).toEqual(paintPlaceholderAtlas());
  expect(atlasPixel(0, 0)).toEqual(MOTIF_BORDER);
  expect(
    MOTIF_VARIANT_BACKGROUNDS.map((_, variant) =>
      atlasPixel(variant * MOTIF_WIDTH_PX + 60, middle),
    ),
  ).toEqual(MOTIF_VARIANT_BACKGROUNDS);
  expect(new Set(MOTIF_VARIANT_BACKGROUNDS.map((color) => color.join(","))).size).toBe(
    BILLBOARD_VARIANTS,
  );
});

it("is part of the landscape scene", () => {
  const scene = new THREE.Scene();

  createScheduler([createLandscapeSystem()], { scene, route: loop });
  expect(scene.getObjectByName("billboards")).toBeInstanceOf(THREE.Group);
});
