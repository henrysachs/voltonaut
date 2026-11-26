import type { EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";

import { biomeFromScenery, biomeHasLake, type Biome } from "./biome.js";
import { biomeObjects } from "./biome-landscape.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import type { RenderSystem } from "./scheduler.js";
import { createTerrain, FOREST_TERRAIN, type TerrainPalette } from "./terrain.js";

export { billboardsInView } from "./billboards.js";

const BIOME_TERRAIN: Readonly<Record<Biome["kind"], TerrainPalette>> = {
  forest: FOREST_TERRAIN,
  coast: { low: 0xd8c896, high: 0x94a86a, shore: 0xe4d9b0, ground: 0xc9b884 },
  alpine: { low: 0x6f7681, high: 0xdfe7ee, shore: 0xeef3f8, ground: 0x8d939c },
  "night-city": { low: 0x22262e, high: 0x303540, shore: 0x2a2e36, ground: 0x191c22 },
};

/** Terrain of the world whose roads are given (spec E10-12), dressed for the route's biome (#75). */
export function createLandscapeSystem(roads: readonly EngineRoute[]): RenderSystem {
  const root = new THREE.Group();

  return {
    id: "landscape",
    order: 15,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its owned static meshes into the Three scene.
    init(context) {
      const biome = biomeFromScenery(context.route.scenery);
      const plan = createLandscapePlan(context.route, roads, 42, biomeHasLake(biome));

      root.add(createTerrain(plan, BIOME_TERRAIN[biome.kind]), ...biomeObjects(biome, plan));
      context.scene.add(root);
    },
    update() {},
    setQuality() {},
    dispose() {
      disposeObject(root);
    },
  };
}
