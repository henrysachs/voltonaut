import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import { heightAt, type Heightfield } from "./heightfield.js";
import { lakeRadius, offsetPosition, planLake, type Lake } from "./lake-plan.js";
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
}

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
  readonly lake: Lake;
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
    lakeRadius(scatter.lake, plant.position) >= 1.2 &&
    nearestRoadM(scatter.corridor, x, z, reachM) > reachM
  );
}

/** One seeded plant beside a road; before 650 m it is always a tree, beyond often a rock. */
function plantAt(
  scatter: Scatter,
  road: EngineRoute,
  roadIndex: number,
  startM: number,
  row: number,
  side: number,
): Plant & { readonly tree: boolean } {
  const { random } = scatter;
  const routeDistanceM = Math.min(road.lengthM - 0.01, startM + random() * 18);
  const ground = offsetPosition(road, routeDistanceM, side * (13 + row * 24 + random() * 14));
  const position = { ...ground, y: heightAt(scatter.terrain, ground.x, ground.z) };
  const shade = random();
  const heightM = 7 + random() * 7;
  const rotationRad = random() * Math.PI * 2;
  const tree = startM < 650 || shade > 0.35;
  const common = { roadIndex, routeDistanceM, position, rotationRad, shade, tree };

  return tree
    ? { ...common, heightM, radiusM: 1.7 + shade }
    : { ...common, heightM: 1, radiusM: 0.7 + shade * 2 };
}

/** Forest along one road: six rows per side over the first 650 m, three beyond. */
function scatterAlong(scatter: Scatter, road: EngineRoute, roadIndex: number): Forest {
  const trees: Plant[] = [];
  const rocks: Plant[] = [];

  for (let startM = 0; startM < road.lengthM; startM += 24) {
    for (const side of [-1, 1]) {
      for (const row of startM < 650 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2]) {
        const { tree, ...plant } = plantAt(scatter, road, roadIndex, startM, row, side);

        if (standsFree(scatter, plant)) (tree ? trees : rocks).push(plant);
      }
    }
  }

  return { trees, rocks };
}

/**
 * Landscape of the world the route belongs to: one terrain raster for all roads, the lake at
 * the start of the ridden route and a seeded forest along every road.
 */
export function createLandscapePlan(
  route: EngineRoute,
  roads: readonly EngineRoute[] = [route],
  seed = 42,
  withLake = true,
): LandscapePlan {
  const lake = planLake(route, withLake);
  const { field, corridor } = planTerrain(roads, withLake ? [lake] : [], seed);
  const scatter: Scatter = { random: seededRandom(seed), lake, terrain: field, corridor };
  const forests = roads.map((road, roadIndex) => scatterAlong(scatter, road, roadIndex));

  return {
    route,
    lake,
    terrain: field,
    apron: route.scenery === "alpine" ? apronSamples(route) : [],
    trees: forests.flatMap((forest) => forest.trees),
    rocks: forests.flatMap((forest) => forest.rocks),
  };
}
