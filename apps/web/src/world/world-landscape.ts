import { biomeHasLake } from "./biome.js";
import { createRegionalLandscape, type RegionalLandscape } from "./landscape-plan.js";
import { createRegionMap, type RegionMap } from "./region-map.js";
import type { RenderWorld } from "./render-world.js";

/** The landscape of a world exactly as the landscape system draws it (ADR-033 §5, §6). */
export interface WorldLandscape {
  readonly landscape: RegionalLandscape;
  readonly regionMap: RegionMap;
}

export function planWorldLandscape(world: RenderWorld, seed = 42): WorldLandscape {
  const regionMap = createRegionMap(
    world.regionRoads,
    world.regions.map((region) => region.id),
  );

  const landscape = createRegionalLandscape(
    world.roads,
    world.regions.map((region) => ({ home: region.home, withLake: biomeHasLake(region.biome) })),
    regionMap,
    seed,
  );

  return { landscape, regionMap };
}
