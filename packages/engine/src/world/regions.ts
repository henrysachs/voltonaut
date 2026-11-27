import type { WorldData, WorldEdgeView, WorldRegionView } from "./types.js";

/** Every edge with the biome of its region, for region maps outside the engine (ADR-033 §6). */
export function edgeViews(data: WorldData): readonly WorldEdgeView[] {
  const scenery = new Map(data.regions.map((region) => [region.id, region.scenery]));

  return data.edges.map((edge) => ({
    id: edge.id,
    regionId: edge.regionId,
    scenery: scenery.get(edge.regionId) ?? "",
    centerline: edge.centerline,
  }));
}

/**
 * Regions with their home path: the first path that stays inside the region on every edge.
 * Region dressing is laid along it; a region without one (only crossed) has none.
 */
export function regionViews(data: WorldData): readonly WorldRegionView[] {
  const regionOf = new Map(data.edges.map((edge) => [edge.id, edge.regionId]));

  const homeOf = (regionId: string): string | undefined =>
    data.paths.find((path) => path.steps.every((step) => regionOf.get(step.edgeId) === regionId))
      ?.id;

  return data.regions.map((region) => ({ ...region, homePathId: homeOf(region.id) }));
}
