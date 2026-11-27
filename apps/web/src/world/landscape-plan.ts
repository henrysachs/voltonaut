import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import { heightAt, type Heightfield } from "./heightfield.js";
import { lakeRadius, offsetPosition, planLake, type Lake } from "./lake-plan.js";
import { dominantRegion, type RegionMap } from "./region-map.js";
import { nearestRoadM, type CorridorIndex } from "./road-corridor.js";
import { apronSamples } from "./road-apron.js";
import type { RoadSample } from "./road-plan.js";
import { planTerrain } from "./terrain-plan.js";

/** Tree crowns and rocks keep at least this much air to every road centerline. */
export const PLANT_ROAD_CLEARANCE_M = 7;

export interface Plant {
  /** Index of the road in the world's road list the plant was scattered along. */
  readonly roadIndex: number;
  readonly routeDistanceM: number;
  readonly position: WorldPos;
  readonly radiusM: number;
  readonly heightM: number;
  readonly rotationRad: number;
  readonly shade: number;
}

export interface LandscapePlan {
  readonly route: EngineRoute;
  readonly lake: Lake;
  readonly terrain: Heightfield;
  /** Alpine road apron edges (#138); empty for every other biome. */
  readonly apron: readonly RoadSample[];
  readonly trees: readonly Plant[];
  readonly rocks: readonly Plant[];
  /** Per road index: plants are grouped into instanced meshes along stretches of this length. */
  readonly stretchesM: readonly number[];
}

/** Plant stretches of a region's home road; connecting roads use longer, fewer stretches. */
export const HOME_STRETCH_M = 250;

export const CONNECTING_STRETCH_M = 500;

/** Ground point beside the route on the drawn terrain mesh. */
export function terrainPosition(
  plan: Pick<LandscapePlan, "route" | "terrain">,
  distanceM: number,
  lateralM: number,
): WorldPos {
  const position = offsetPosition(plan.route, distanceM, lateralM);

  return { ...position, y: heightAt(plan.terrain, position.x, position.z) };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    return state / 4_294_967_296;
  };
}

interface Scatter {
  readonly random: () => number;
  readonly lakes: readonly Lake[];
  readonly terrain: Heightfield;
  readonly corridor: CorridorIndex;
}

interface Forest {
  readonly trees: readonly Plant[];
  readonly rocks: readonly Plant[];
}

/** Keeps a plant when its crown clears every road and it stands outside the lake. */
function standsFree(scatter: Scatter, plant: Plant): boolean {
  const { x, z } = plant.position;
  const reachM = PLANT_ROAD_CLEARANCE_M + plant.radiusM;

  return (
    scatter.lakes.every((lake) => lakeRadius(lake, plant.position) >= 1.2) &&
    nearestRoadM(scatter.corridor, x, z, reachM) > reachM
  );
}

/** Where along a road one plant is scattered; the dense stretch grows trees only. */
interface Spot {
  readonly startM: number;
  readonly row: number;
  readonly side: number;
  readonly dense: boolean;
}

/** One seeded plant beside a road; in the dense stretch it is always a tree, beyond often a rock. */
function plantAt(
  scatter: Scatter,
  road: EngineRoute,
  roadIndex: number,
  { startM, row, side, dense }: Spot,
): Plant & { readonly tree: boolean } {
  const { random } = scatter;
  const routeDistanceM = Math.min(road.lengthM - 0.01, startM + random() * 18);
  const ground = offsetPosition(road, routeDistanceM, side * (13 + row * 24 + random() * 14));
  const position = { ...ground, y: heightAt(scatter.terrain, ground.x, ground.z) };
  const shade = random();
  const heightM = 7 + random() * 7;
  const rotationRad = random() * Math.PI * 2;
  const tree = dense || shade > 0.35;
  const common = { roadIndex, routeDistanceM, position, rotationRad, shade, tree };

  return tree
    ? { ...common, heightM, radiusM: 1.7 + shade }
    : { ...common, heightM: 1, radiusM: 0.7 + shade * 2 };
}

/** Dense forest at the start of a region's home road, by the lake. */
const DENSE_START_M = 650;

/**
 * Forest along one road: six rows per side over the first 650 m of a home road, three elsewhere.
 * Connecting roads start at junctions and stay sparse there (ADR-033 step 3).
 */
function scatterAlong(
  scatter: Scatter,
  road: EngineRoute,
  roadIndex: number,
  denseStartM: number,
): Forest {
  const trees: Plant[] = [];
  const rocks: Plant[] = [];

  for (let startM = 0; startM < road.lengthM; startM += 24) {
    const dense = startM < denseStartM;

    for (const side of [-1, 1]) {
      for (const row of dense ? [0, 1, 2, 3, 4, 5] : [0, 1, 2]) {
        const spot = { startM, row, side, dense };
        const { tree, ...plant } = plantAt(scatter, road, roadIndex, spot);

        if (standsFree(scatter, plant)) (tree ? trees : rocks).push(plant);
      }
    }
  }

  return { trees, rocks };
}

/** One region of the landscape: the path its dressing follows and whether it has a lake. */
export interface LandscapeRegion {
  readonly home: EngineRoute;
  readonly withLake: boolean;
}

/** The world terrain with one plan per region (ADR-033 §6); all plans share one raster. */
export interface RegionalLandscape {
  readonly terrain: Heightfield;
  readonly lakes: readonly Lake[];
  readonly plans: readonly LandscapePlan[];
}

/**
 * Landscape of a world: one terrain raster for all roads with every region's lake, a seeded
 * forest along every road, and per region a plan whose plants are those the region map gives
 * to it. Region order follows the map's region order.
 */
export function createRegionalLandscape(
  roads: readonly EngineRoute[],
  regions: readonly LandscapeRegion[],
  regionMap: RegionMap,
  seed = 42,
): RegionalLandscape {
  const lakes = regions.map((region) => planLake(region.home, region.withLake));
  const carved = lakes.filter((_, index) => regions[index]?.withLake === true);
  const { field, corridor } = planTerrain(roads, carved, seed);
  const scatter: Scatter = { random: seededRandom(seed), lakes, terrain: field, corridor };

  const forests = roads.map((road, roadIndex) =>
    scatterAlong(
      scatter,
      road,
      roadIndex,
      regions.some((region) => region.home === road) ? DENSE_START_M : 0,
    ),
  );

  const owns = (index: number, plant: Plant): boolean =>
    dominantRegion(regionMap, plant.position.x, plant.position.z) === index;

  const homeRoads = new Set(regions.map((region) => region.home));

  const stretchesM = roads.map((road) =>
    homeRoads.has(road) ? HOME_STRETCH_M : CONNECTING_STRETCH_M,
  );

  return {
    terrain: field,
    lakes,
    plans: regions.map((region, index) => ({
      stretchesM,
      route: region.home,
      lake: lakes[index] ?? planLake(region.home, false),
      terrain: field,
      apron: region.home.scenery === "alpine" ? apronSamples(region.home) : [],
      trees: forests.flatMap((forest) => forest.trees).filter((plant) => owns(index, plant)),
      rocks: forests.flatMap((forest) => forest.rocks).filter((plant) => owns(index, plant)),
    })),
  };
}

/** Landscape of a single-region world whose dressing follows the given route. */
export function createLandscapePlan(
  route: EngineRoute,
  roads: readonly EngineRoute[] = [route],
  seed = 42,
  withLake = true,
): LandscapePlan {
  const regionMap: RegionMap = { regionIds: [route.id], weightsAt: () => [1] };
  const landscape = createRegionalLandscape(roads, [{ home: route, withLake }], regionMap, seed);
  const plan = landscape.plans[0];

  if (plan === undefined) throw new Error("single-region landscape has no plan");

  return plan;
}
