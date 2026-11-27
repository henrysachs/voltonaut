import * as THREE from "three";

import { biomeObjects } from "./biome-landscape.js";
import { DressingGroup } from "./dressing-group.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { regionInView, type RegionBounds } from "./region-visibility.js";
import type { RenderWorld } from "./render-world.js";

/** One drawable of a region's dressing with the ground area its geometry covers. */
export interface CulledPart {
  readonly object: THREE.Object3D;
  readonly bounds: RegionBounds;
}

export interface RegionDressing {
  readonly group: DressingGroup;
  readonly parts: readonly CulledPart[];
}

/** Ground area of an object's geometry, all instances included. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three computes the box from the object's own mutable world matrix.
function groundBounds(object: THREE.Object3D): RegionBounds {
  const box = new THREE.Box3().setFromObject(object);

  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

/** Meshes, points and lines: everything that costs a draw call. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene objects.
function drawables(root: THREE.Object3D): readonly THREE.Object3D[] {
  const found: THREE.Object3D[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene objects.
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Line
    ) {
      found.push(object);
    }
  });

  return found;
}

/**
 * Each region's dressing in a group of its own, with every drawable's ground area. Dressing groups
 * hold no lights (dressing-group.ts); a biome's lights are its atmosphere (biome-atmosphere.ts).
 */
export function regionDressings(
  world: RenderWorld,
  plans: readonly LandscapePlan[],
): readonly RegionDressing[] {
  const several = plans.length > 1;

  return plans.map((plan, index) => {
    const group = new DressingGroup();
    const region = world.regions[index];

    group.name = `region-${region?.id ?? index}`;
    group.add(...biomeObjects(region?.biome ?? { kind: "forest" }, plan));

    // A single region is never culled, so it needs no ground areas (no extra start-up work).
    if (!several) return { group, parts: [] };

    group.updateMatrixWorld(true);

    return {
      group,
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Each part keeps its mutable Three object to switch its visibility later.
      parts: drawables(group).map((object) => ({ object, bounds: groundBounds(object) })),
    };
  });
}

/**
 * Draws each dressing part only while the rider is within view range of its own ground area
 * (ADR-033 §6). A single-region world always shows all of its dressing.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The dressing parts are owned Three objects whose visibility this system switches.
export function showInView(dressings: readonly RegionDressing[], x: number, z: number): void {
  if (dressings.length < 2) return;

  for (const { parts } of dressings) {
    for (const { object, bounds } of parts) object.visible = regionInView(bounds, x, z);
  }
}
