import {
  createRoute,
  WORLDS,
  type EngineRoute,
  type World,
  type WorldEdgeView,
} from "@voltonaut/engine";

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
  /** Every road of the world once: the regions' home paths and the edges none of them covers. */
  readonly roads: readonly EngineRoute[];
  readonly regions: readonly RenderRegion[];
  /** Every edge with its region, for the region map. */
  readonly regionRoads: readonly RegionRoad[];
  /** Edges off the given path as open roads, drawn beside the ridden route. */
  readonly sideRoads: (pathId: string) => readonly EngineRoute[];
}

/** An edge as an open road of its own. */
function edgeRoad(edge: WorldEdgeView): EngineRoute {
  return createRoute({
    id: edge.id,
    name: edge.id,
    lengthM: edge.lengthM,
    loop: false,
    centerline: edge.centerline,
    profileSamples: edge.profileSamples,
    segments: [],
    scenery: edge.scenery,
  });
}

/** Render view of a world; every region needs a home path to carry its dressing. */
export function renderWorldOf(world: World): RenderWorld {
  const regions = world.regions.map((region): RenderRegion => {
    const data = world.route(region.homePathId ?? "");

    if (data === undefined) throw new Error(`Region ${region.id} has no home path to dress`);

    return { id: region.id, biome: biomeFromScenery(region.scenery), home: createRoute(data) };
  });

  const homeIds = new Set(regions.map((region) => region.home.id));
  const uncovered = world.edges.filter((edge) => !edge.pathIds.some((id) => homeIds.has(id)));

  return {
    roads: [...regions.map((region) => region.home), ...uncovered.map((edge) => edgeRoad(edge))],
    regions,
    regionRoads: world.edges,
    sideRoads: (pathId) =>
      world.edges.flatMap((edge) => (edge.pathIds.includes(pathId) ? [] : [edgeRoad(edge)])),
  };
}

/** The world the route belongs to, as the landscape draws it. */
export function resolveRenderWorld(routeId: string): RenderWorld {
  const world = WORLDS.find((candidate) => candidate.route(routeId) !== undefined);

  if (world === undefined) throw new Error(`Unsupported render route: ${routeId}`);

  return renderWorldOf(world);
}
