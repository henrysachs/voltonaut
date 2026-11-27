import type { WorldPos } from "@voltonaut/engine";

import { heightAt, type Heightfield } from "./heightfield.js";

/** Box of one vine chord: as wide and high as a trained vine, a little longer than its chord. */
export const VINE_ROW_WIDTH_M = 0.9;
export const VINE_ROW_HEIGHT_M = 1.1;
export const VINE_ROW_OVERHANG_M = 0.2;

/** How far a vine box reaches below the lowest ground under its corners. */
export const VINE_ROW_SINK_M = 0.05;

/**
 * Share of its height by which the ground under a box's centre may rise above the lowest ground
 * under its corners, where the box stands. Steeper, the slope swallows it (dressing-ground).
 */
const MAX_FOOT_RISE_SHARE = 0.3;

interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/** One straight piece of a vine row, level along its contour. */
export interface VineChord {
  /** Lowest drawn ground under the corners of its box; the box stands on it. */
  readonly position: WorldPos;
  readonly yawRad: number;
  readonly lengthM: number;
}

export function standsOnSlope(centreM: number, footM: number, heightM: number): boolean {
  return centreM - footM <= MAX_FOOT_RISE_SHARE * heightM;
}

/** Lowest drawn ground under the centre and the base corners of a yawed box (dressing-ground). */
export function lowestUnderBox(
  terrain: Readonly<Heightfield>,
  centre: GroundPoint,
  yawRad: number,
  sizeX: number,
  sizeZ: number,
): number {
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  let lowestM = heightAt(terrain, centre.x, centre.z);

  for (const [alongX, alongZ] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const localX = (alongX * sizeX) / 2;
    const localZ = (alongZ * sizeZ) / 2;

    lowestM = Math.min(
      lowestM,
      heightAt(
        terrain,
        centre.x + localX * cos + localZ * sin,
        centre.z - localX * sin + localZ * cos,
      ),
    );
  }

  return lowestM;
}

/** The vine box from one chord end to the next, or undefined where the slope would swallow it. */
export function vineChordBetween(
  terrain: Readonly<Heightfield>,
  from: GroundPoint,
  end: GroundPoint,
): VineChord | undefined {
  const centre = { x: (from.x + end.x) / 2, z: (from.z + end.z) / 2 };
  const yawRad = -Math.atan2(end.z - from.z, end.x - from.x);
  const lengthM = Math.hypot(end.x - from.x, end.z - from.z);

  const footM = lowestUnderBox(
    terrain,
    centre,
    yawRad,
    lengthM + VINE_ROW_OVERHANG_M,
    VINE_ROW_WIDTH_M,
  );

  if (!standsOnSlope(heightAt(terrain, centre.x, centre.z), footM, VINE_ROW_HEIGHT_M)) {
    return undefined;
  }

  return { position: { x: centre.x, y: footM, z: centre.z }, yawRad, lengthM };
}
