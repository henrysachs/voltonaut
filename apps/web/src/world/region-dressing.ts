import * as THREE from "three";

import { biomeObjects } from "./biome-landscape.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { regionBounds, regionInView, type RegionBounds } from "./region-visibility.js";
import type { RenderWorld } from "./render-world.js";

export interface RegionDressing {
  readonly group: THREE.Group;
  readonly bounds: RegionBounds;
}

/** Each region's dressing in a group of its own, with the area it can be seen from. */
export function regionDressings(
  world: RenderWorld,
  plans: readonly LandscapePlan[],
): readonly RegionDressing[] {
  return plans.map((plan, index) => {
    const group = new THREE.Group();
    const region = world.regions[index];

    group.name = `region-${region?.id ?? index}`;
    group.add(...biomeObjects(region?.biome ?? { kind: "forest" }, plan));

    return { group, bounds: regionBounds(plan.route) };
  });
}

/**
 * Shows each region's dressing only while the rider is in view range of it (ADR-033 §6); a
 * single-region world always shows its one dressing.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The dressing groups are owned Three objects whose visibility this system switches.
export function showInView(dressings: readonly RegionDressing[], x: number, z: number): void {
  if (dressings.length < 2) return;

  for (const { group, bounds } of dressings) group.visible = regionInView(bounds, x, z);
}
