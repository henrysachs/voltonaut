import * as THREE from "three";

import { biomeFromScenery, type Biome } from "./biome.js";
import { createAlpineScenery, createCoastScenery, createNightCityScenery } from "./biomeScenery.js";
import { planBillboards } from "./billboard-plan.js";
import { createBillboards } from "./billboards.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { disposeObject } from "./resources.js";
import type { RenderSystem } from "./scheduler.js";
import { createScenery } from "./scenery.js";
import { createLake, createTerrain, FOREST_TERRAIN, type TerrainPalette } from "./terrain.js";

export { billboardsInView } from "./billboards.js";

const BIOME_TERRAIN: Readonly<Record<Biome["kind"], TerrainPalette>> = {
  forest: FOREST_TERRAIN,
  coast: { low: 0xd8c896, high: 0x94a86a, shore: 0xe4d9b0, ground: 0xc9b884 },
  alpine: { low: 0x6f7681, high: 0xdfe7ee, shore: 0xeef3f8, ground: 0x8d939c },
  "night-city": { low: 0x22262e, high: 0x303540, shore: 0x2a2e36, ground: 0x191c22 },
};

/** The forest biome keeps its lake; the new biomes drop it (#75). */
function biomeHasLake(biome: Biome): boolean {
  return biome.kind === "forest" || biome.kind === "coast";
}

export function createLandscapeSystem(): RenderSystem {
  const root = new THREE.Group();

  return {
    id: "landscape",
    order: 15,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its owned static meshes into the Three scene.
    init(context) {
      const biome = biomeFromScenery(context.route.scenery);
      const plan = createLandscapePlan(context.route, 42, biomeHasLake(biome));

      root.add(createTerrain(plan, BIOME_TERRAIN[biome.kind]));

      // The forest keeps the original E3 visuals untouched, so screenshot baselines stay valid.
      if (biome.kind === "forest") {
        root.add(
          createLake(plan),
          createScenery(plan),
          createBillboards(planBillboards(plan).billboards),
        );
      } else if (biome.kind === "coast") {
        root.add(createLake(plan), createCoastScenery(plan));
      } else if (biome.kind === "alpine") {
        root.add(createAlpineScenery(plan));
      } else {
        root.add(createNightCityScenery(plan));
      }

      context.scene.add(root);
    },
    update() {},
    setQuality() {},
    dispose() {
      disposeObject(root);
    },
  };
}
