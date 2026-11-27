import * as THREE from "three";

import type { Biome } from "./biome.js";
import { worldAtmosphere } from "./biome-atmosphere.js";
import { regionDressings, showInView, type RegionDressing } from "./region-dressing.js";
import type { RenderWorld } from "./render-world.js";
import { disposeObject } from "./resources.js";
import type { RenderSystem } from "./scheduler.js";
import { createWorldTerrain } from "./terrain.js";
import { blendedShades, FOREST_TERRAIN, shadesOf, type TerrainPalette } from "./terrain-shades.js";
import { planWorldLandscape } from "./world-landscape.js";

export { billboardsInView } from "./billboards.js";

const BIOME_TERRAIN: Readonly<Record<Biome["kind"], TerrainPalette>> = {
  forest: FOREST_TERRAIN,
  coast: { low: 0xd8c896, high: 0x94a86a, shore: 0xe4d9b0, ground: 0xc9b884 },
  alpine: { low: 0x6f7681, high: 0xdfe7ee, shore: 0xeef3f8, ground: 0x8d939c },
  "night-city": { low: 0x22262e, high: 0x303540, shore: 0x2a2e36, ground: 0x191c22 },
  "stone-age": { low: 0xa88a52, high: 0xd8ab72, shore: 0xe2cc98, ground: 0x9a7446 },
};

/** Terrain palette of a biome (#75). */
function biomeTerrain(biome: Biome): TerrainPalette {
  return BIOME_TERRAIN[biome.kind];
}

/**
 * The world landscape (spec E10-12, ADR-033 §6): one terrain for all roads whose colours blend
 * between regions, and every region's dressing along its home path.
 */
export function createLandscapeSystem(world: RenderWorld): RenderSystem {
  const root = new THREE.Group();
  const dressings: RegionDressing[] = [];

  return {
    id: "landscape",
    order: 15,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its owned static meshes into the Three scene.
    init(context) {
      const { landscape, regionMap } = planWorldLandscape(world);
      const palettes = world.regions.map((region) => biomeTerrain(region.biome));
      const shades = palettes.map((palette) => shadesOf(palette));

      const terrain = createWorldTerrain(
        landscape.terrain,
        {
          lakes: landscape.lakes,
          shadesAt: (x, z) => blendedShades(shades, regionMap.weightsAt(x, z)),
        },
        landscape.plans.map((plan, index) => ({
          samples: plan.apron,
          groundColor: palettes[index]?.ground ?? FOREST_TERRAIN.ground,
        })),
      );

      root.add(terrain);

      for (const dressing of regionDressings(world, landscape.plans)) {
        root.add(dressing.group);
        dressings.push(dressing);
      }

      for (const light of worldAtmosphere(world)) root.add(light);

      context.scene.add(root);
    },
    update(frame) {
      showInView(dressings, frame.ride.worldPos.x, frame.ride.worldPos.z);
    },
    setQuality() {},
    dispose() {
      disposeObject(root);
    },
  };
}
