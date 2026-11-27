import type { WorldPos } from "@voltonaut/engine";

import {
  groundPosition,
  routeClearanceM,
  routeCorridorSamples,
  type ChunkItem,
} from "./biomeSceneryShared.js";
import { heightAt } from "./heightfield.js";
import type { LandscapePlan } from "./landscape-plan.js";

/** The only neon hues of the city. */
export const NEON = { cyan: 0.5, magenta: 0.87, amber: 0.11 } as const;
export const NEON_HUES: readonly number[] = Object.values(NEON);

/** A tower's base sits this far below the lowest terrain under its footprint. */
const BASE_DEPTH_M = 0.5;

export const TOWER_DEPTH_M = 15;
export const TOWER_FRONTAGE_M = 15;

/** Minimum distance from a building centre to any road leg. */
export const BUILDING_CLEARANCE_M = 20;

interface RowSpec {
  readonly facadeLateralM: number;
  readonly spacingM: number;
  readonly minHeightM: number;
  readonly maxHeightM: number;
  readonly neonTubes: boolean;
}

/** The near row forms the street wall, the far row the skyline behind it. */
const ROWS: readonly RowSpec[] = [
  { facadeLateralM: 13, spacingM: 20, minHeightM: 22, maxHeightM: 70, neonTubes: true },
  { facadeLateralM: 44, spacingM: 30, minHeightM: 55, maxHeightM: 118, neonTubes: false },
];

export interface BuildingItem extends ChunkItem {
  /** Centre of the base, below the terrain under every footprint corner. */
  readonly position: WorldPos;
  readonly rotationRad: number;
  /** From the base to the roof. */
  readonly heightM: number;
  readonly frontageM: number;
  readonly shade: number;
}

export interface NeonTubeItem extends ChunkItem {
  readonly position: WorldPos;
  readonly heightM: number;
  readonly hue: number;
}

export interface BuildingPlan {
  readonly buildings: readonly BuildingItem[];
  readonly tubes: readonly NeonTubeItem[];
}

interface Placement {
  readonly building: BuildingItem;
  readonly tube: NeonTubeItem | undefined;
}

function neonHueOf(roll: number): number {
  return NEON_HUES[Math.floor(roll * NEON_HUES.length) % NEON_HUES.length] ?? NEON.cyan;
}

function placeBuilding(
  plan: Readonly<LandscapePlan>,
  row: Readonly<RowSpec>,
  side: 1 | -1,
  distanceM: number,
  samples: readonly WorldPos[],
  random: () => number,
): Placement | undefined {
  const gap = random() < 0.07;
  const jitterM = random() * 3;
  const heightM = row.minHeightM + random() * (row.maxHeightM - row.minHeightM);
  const frontageM = TOWER_FRONTAGE_M * (0.85 + random() * 0.45);
  const tubeRoll = random();
  const shade = random();
  const facadeM = row.facadeLateralM + jitterM;

  const ground = groundPosition(plan, distanceM, side * (facadeM + TOWER_DEPTH_M / 2));

  if (gap || routeClearanceM(ground, samples) < BUILDING_CLEARANCE_M) return undefined;

  const headingRad = plan.route.headingRad(distanceM);
  const baseM = footprintFloorM(plan, ground, headingRad, frontageM) - BASE_DEPTH_M;
  const position = { x: ground.x, y: baseM, z: ground.z };

  const hasTube = row.neonTubes && tubeRoll < 0.4;

  return {
    building: {
      routeDistanceM: distanceM,
      position,
      rotationRad: -headingRad,
      heightM: ground.y + heightM - baseM,
      frontageM,
      shade,
    },
    tube: hasTube
      ? {
          routeDistanceM: distanceM,
          position: groundPosition(plan, distanceM, side * (facadeM - 0.4)),
          heightM: 6 + tubeRoll * 30,
          hue: neonHueOf(shade),
        }
      : undefined,
  };
}

/** Lowest drawn terrain under the centre and the four corners of a tower's footprint. */
function footprintFloorM(
  plan: Readonly<LandscapePlan>,
  centre: Readonly<WorldPos>,
  headingRad: number,
  frontageM: number,
): number {
  const along = { x: Math.cos(headingRad), z: Math.sin(headingRad) };
  const lateral = { x: -Math.sin(headingRad), z: Math.cos(headingRad) };
  let floorM = centre.y;

  for (const alongM of [-frontageM / 2, frontageM / 2]) {
    for (const lateralM of [-TOWER_DEPTH_M / 2, TOWER_DEPTH_M / 2]) {
      const x = centre.x + along.x * alongM + lateral.x * lateralM;
      const z = centre.z + along.z * alongM + lateral.z * lateralM;

      floorM = Math.min(floorM, heightAt(plan.terrain, x, z));
    }
  }

  return floorM;
}

/** Deterministic urban canyon: towers on both sides, kept off every road leg. */
export function planBuildings(plan: Readonly<LandscapePlan>, random: () => number): BuildingPlan {
  const samples = routeCorridorSamples(plan.route);
  const buildings: BuildingItem[] = [];
  const tubes: NeonTubeItem[] = [];

  for (const row of ROWS) {
    for (const side of [1, -1] as const) {
      let distanceM = random() * row.spacingM;

      while (distanceM < plan.route.lengthM) {
        const placement = placeBuilding(plan, row, side, distanceM, samples, random);

        if (placement !== undefined) buildings.push(placement.building);

        if (placement?.tube !== undefined) tubes.push(placement.tube);

        distanceM += row.spacingM * (0.85 + random() * 0.3);
      }
    }
  }

  return { buildings, tubes };
}
