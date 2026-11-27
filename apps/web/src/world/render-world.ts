import { createRoute, WORLDS, type EngineRoute, type World } from "@voltonaut/engine";

import { biomeFromScenery, type Biome } from "./biome.js";
import type { RegionRoad } from "./region-map.js";

/** One region as the landscape draws it: its biome and the road its dressing follows. */
export interface RenderRegion {
  readonly id: string;
  readonly biome: Biome;
  readonly home: EngineRoute;
}

/** Everything the landscape needs from a world (ADR-033 §5, §6). */
export interface RenderWorld {
  /** Every path of the world; the terrain flattens all of them. */
  readonly roads: readonly EngineRoute[];
  readonly regions: readonly RenderRegion[];
  /** Every edge with its region, for the region map. */
  readonly regionRoads: readonly RegionRoad[];
}

/** Render view of a world; every region needs a home path to carry its dressing. */
export function renderWorldOf(world: World): RenderWorld {
  const roads = world.routes.map((data) => createRoute(data));

  const regions = world.regions.map((region): RenderRegion => {
    const home = roads.find((road) => road.id === region.homePathId);

    if (home === undefined) throw new Error(`Region ${region.id} has no home path to dress`);

    return { id: region.id, biome: biomeFromScenery(region.scenery), home };
  });

  return { roads, regions, regionRoads: world.edges };
}

/** The world the route belongs to, as the landscape draws it. */
export function resolveRenderWorld(routeId: string): RenderWorld {
  const world = WORLDS.find((candidate) => candidate.route(routeId) !== undefined);

  if (world === undefined) throw new Error(`Unsupported render route: ${routeId}`);

  return renderWorldOf(world);
}
