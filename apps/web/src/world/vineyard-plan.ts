import type { WorldPos } from "@voltonaut/engine";
import { heightAt, type Heightfield } from "./heightfield.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { offsetPosition } from "./lake-plan.js";
import {
  createCorridorIndex,
  nearestRoadM,
  roadLine,
  type CorridorIndex,
} from "./road-corridor.js";
import { vineChordBetween, type VineChord } from "./vineyard-footing.js";

/** Every vine row, cypress and house keeps this much air to the centerline of every road. */
export const VINE_CLEARANCE_M = 10;

export const CYPRESS_CLEARANCE_M = 9;

export const HOUSE_CLEARANCE_M = 20;

const ROW_CHORD_M = 6;
const MAX_ROW_CHORDS = 8;
const ROW_SPACING_M = 7;
const ROW_SEED_STEP_M = 90;
const FIRST_ROW_LATERAL_M = 18;
const ROWS_PER_SIDE = 8;
const MIN_SLOPE = 0.04;
const MAX_ROW_TURN_RAD = 0.6;

/** A chord whose far end misses the row's height by more than this ends the row. */
const MAX_LEVEL_ERROR_M = 0.4;

/**
 * Rise per metre along a chord above which it is no longer level; such a chord ends the row.
 * The level check alone lets both ends miss the row's height by MAX_LEVEL_ERROR_M, which on a
 * short pulled chord allows far steeper pieces.
 */
const MAX_CHORD_RISE = 0.05;

/** One instanced mesh holds every vine chord; this keeps it near 80 k triangles. */
export const MAX_VINE_CHORDS = 7000;

export const HOUSE_WIDTH_M = 7;
export const HOUSE_DEPTH_M = 5.5;
export const HOUSE_HEIGHT_M = 4;

/** Probe distance of the finite-difference gradient. */
const GRADIENT_PROBE_M = 2;

/** Largest correction that pulls a chord end back onto its contour. */
const MAX_PULL_M = 2;

export interface Cypress {
  readonly position: WorldPos;
  readonly heightM: number;
  readonly radiusM: number;
  readonly shade: number;
}

export interface StoneHouse {
  /** Ground height at the lowest corner; the body sits on it. */
  readonly position: WorldPos;
  readonly yawRad: number;
  readonly shade: number;
}

export interface VineyardPlan {
  readonly chords: readonly VineChord[];
  readonly cypresses: readonly Cypress[];
  readonly houses: readonly StoneHouse[];
}

interface Direction {
  readonly x: number;
  readonly z: number;
}

/** The landscape plan with an index of every road of the world for clearance queries. */
export type VineyardSite = Readonly<LandscapePlan> & { readonly corridor: CorridorIndex };

export function vineyardSite(plan: Readonly<LandscapePlan>): VineyardSite {
  return { ...plan, corridor: createCorridorIndex(plan.roads.map((road) => roadLine(road))) };
}

export function freeOfRoads(plan: VineyardSite, x: number, z: number, clearanceM: number): boolean {
  return nearestRoadM(plan.corridor, x, z, clearanceM) > clearanceM;
}

/** Slope vector of the drawn terrain at a point (rise per metre along +x and +z). */
function gradientAt(terrain: Readonly<Heightfield>, x: number, z: number): Direction {
  const probeM = GRADIENT_PROBE_M;

  return {
    x: (heightAt(terrain, x + probeM, z) - heightAt(terrain, x - probeM, z)) / (2 * probeM),
    z: (heightAt(terrain, x, z + probeM) - heightAt(terrain, x, z - probeM)) / (2 * probeM),
  };
}

/** Vine parcels: patches of about 300 m on which rows are planted. */
function inParcel(x: number, z: number): boolean {
  return Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.4) > -0.15;
}

/** Moves a point along the slope until its raster height meets the level (two corrections). */
function pulledOntoLevel(
  terrain: Readonly<Heightfield>,
  levelM: number,
  startX: number,
  startZ: number,
): Direction {
  let x = startX;
  let z = startZ;

  for (let round = 0; round < 2; round += 1) {
    const slope = gradientAt(terrain, x, z);
    const steepness = Math.hypot(slope.x, slope.z);

    if (steepness < MIN_SLOPE) break;

    const pullM = Math.max(
      -MAX_PULL_M,
      Math.min(MAX_PULL_M, (levelM - heightAt(terrain, x, z)) / steepness),
    );

    x += (slope.x / steepness) * pullM;
    z += (slope.z / steepness) * pullM;
  }

  return { x, z };
}

interface RowCursor {
  readonly x: number;
  readonly z: number;
  readonly heading: Direction | undefined;
}

/** A chord keeps its row level when its end meets the row's height and it rises no steeper. */
function staysLevel(
  terrain: Readonly<Heightfield>,
  levelM: number,
  from: Direction,
  end: Direction,
): boolean {
  const endM = heightAt(terrain, end.x, end.z);
  const lengthM = Math.hypot(end.x - from.x, end.z - from.z);

  return (
    Math.abs(endM - levelM) <= MAX_LEVEL_ERROR_M &&
    Math.abs(endM - heightAt(terrain, from.x, from.z)) <= MAX_CHORD_RISE * lengthM
  );
}

/** Next chord of a row from the cursor, or undefined where the row ends. */
function nextChord(
  plan: VineyardSite,
  levelM: number,
  from: Readonly<RowCursor>,
): { readonly chord: VineChord; readonly cursor: RowCursor } | undefined {
  const { terrain } = plan;
  const slope = gradientAt(terrain, from.x, from.z);
  const steepness = Math.hypot(slope.x, slope.z);

  if (steepness < MIN_SLOPE) return undefined;

  const along = { x: -slope.z / steepness, z: slope.x / steepness };

  const flip =
    from.heading !== undefined && from.heading.x * along.x + from.heading.z * along.z < 0;

  const step = flip ? { x: -along.x, z: -along.z } : along;

  const turnRad =
    from.heading === undefined
      ? 0
      : Math.acos(Math.min(1, from.heading.x * step.x + from.heading.z * step.z));

  const end = pulledOntoLevel(
    terrain,
    levelM,
    from.x + step.x * ROW_CHORD_M,
    from.z + step.z * ROW_CHORD_M,
  );

  const midX = (from.x + end.x) / 2;
  const midZ = (from.z + end.z) / 2;

  const blocked =
    turnRad > MAX_ROW_TURN_RAD ||
    !staysLevel(terrain, levelM, from, end) ||
    !freeOfRoads(plan, end.x, end.z, VINE_CLEARANCE_M) ||
    !freeOfRoads(plan, midX, midZ, VINE_CLEARANCE_M);

  const chord = blocked ? undefined : vineChordBetween(terrain, from, end);

  return chord === undefined
    ? undefined
    : {
        chord,
        cursor: { x: end.x, z: end.z, heading: step },
      };
}

/**
 * One vine row along the contour line of the raster that passes through the start: each chord
 * follows the level direction (perpendicular to the slope) and is pulled back onto the start
 * height. The row ends on flat ground, at a sharp bend, where a chord would rise or before any
 * road.
 */
function traceRow(plan: VineyardSite, startX: number, startZ: number): readonly VineChord[] {
  const levelM = heightAt(plan.terrain, startX, startZ);
  const chords: VineChord[] = [];
  let cursor: RowCursor | undefined = { x: startX, z: startZ, heading: undefined };

  if (!freeOfRoads(plan, startX, startZ, VINE_CLEARANCE_M)) return chords;

  while (cursor !== undefined && chords.length < MAX_ROW_CHORDS) {
    const next = nextChord(plan, levelM, cursor);

    if (next !== undefined) chords.push(next.chord);

    cursor = next?.cursor;
  }

  return chords;
}

export function vineChords(plan: VineyardSite, random: () => number): readonly VineChord[] {
  const chords: VineChord[] = [];

  for (let distanceM = 0; distanceM < plan.route.lengthM; distanceM += ROW_SEED_STEP_M) {
    for (const side of [-1, 1]) {
      for (let row = 0; row < ROWS_PER_SIDE; row += 1) {
        const lateralM = side * (FIRST_ROW_LATERAL_M + row * ROW_SPACING_M + random() * 2);
        const seed = offsetPosition(plan.route, distanceM + random() * 20, lateralM);
        const planted = random() < 0.85 && inParcel(seed.x, seed.z);

        if (planted && chords.length < MAX_VINE_CHORDS) {
          chords.push(...traceRow(plan, seed.x, seed.z).slice(0, MAX_VINE_CHORDS - chords.length));
        }
      }
    }
  }

  return chords;
}
