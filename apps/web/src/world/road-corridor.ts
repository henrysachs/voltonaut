import type { EngineRoute } from "@voltonaut/engine";

import { createCellGrid, itemsNear, type CellGrid } from "./cell-grid.js";
import { roadSampleDistances } from "./road-plan.js";

/** The terrain stays this far below the road profile wherever the corridor is flat. */
export const ROAD_SINK_M = 0.06;

/** Embankment: flat to the shoulder edge, then a smooth blend into the natural ground. */
export const EMBANKMENT_FLAT_M = 4;

const EMBANKMENT_BLEND_M = 32;

/**
 * Bank cap: within this distance no terrain point rises above the corridor floor; beyond it the
 * cap climbs CAP_SLOPE. It covers the band ceiling's reach (4 m shoulder + 11.3 m cell
 * diagonal) and 1 m slack, so the uphill bank starts where the ceiling ends.
 */
export const CAP_FLAT_M = 17;

const CAP_SLOPE = 1;

/** Roads farther away neither blend (ends at 36 m) nor cap (31 m above the floor) the ground. */
export const CORRIDOR_RANGE_M = 48;

export interface RoadPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly distanceM: number;
}

/** Drawn road centerline: ribbon support points with the profile height, linear between. */
export interface RoadLine {
  readonly points: readonly RoadPoint[];
  readonly loop: boolean;
  readonly lengthM: number;
  readonly spacingM: number;
}

export interface CorridorCandidate {
  readonly distanceM: number;
  readonly floorM: number;
}

interface ChordRef {
  readonly line: RoadLine;
  readonly chord: number;
}

export interface CorridorIndex {
  readonly chords: readonly ChordRef[];
  readonly grid: CellGrid;
}

interface Foot {
  readonly t: number;
  readonly distanceM: number;
}

export function roadLine(route: EngineRoute): RoadLine {
  const points = roadSampleDistances(route).map((distanceM) => {
    const position = route.worldPos(distanceM);

    return { x: position.x, z: position.z, y: position.y, distanceM };
  });

  return {
    points,
    loop: route.loop,
    lengthM: route.lengthM,
    spacingM: route.lengthM / (points.length - 1),
  };
}

function point(line: RoadLine, index: number): RoadPoint {
  const found = line.points[index];

  if (found === undefined) throw new RangeError(`road point ${index} is missing`);

  return found;
}

/** Buckets every chord of every road into 32 m cells for range queries. */
export function createCorridorIndex(lines: readonly RoadLine[]): CorridorIndex {
  const chords = lines.flatMap((line) =>
    line.points.slice(1).map((_, chord): ChordRef => ({ line, chord })),
  );

  const boxes = chords.map(({ line, chord }) => {
    const a = point(line, chord);
    const b = point(line, chord + 1);

    return {
      minX: Math.min(a.x, b.x),
      minZ: Math.min(a.z, b.z),
      maxX: Math.max(a.x, b.x),
      maxZ: Math.max(a.z, b.z),
    };
  });

  return { chords, grid: createCellGrid(boxes, 32) };
}

function footOn(line: RoadLine, chord: number, x: number, z: number): Foot {
  const a = point(line, chord);
  const b = point(line, chord + 1);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));

  return { t, distanceM: Math.hypot(a.x + t * dx - x, a.z + t * dz - z) };
}

function chordsNear(
  index: CorridorIndex,
  x: number,
  z: number,
  rangeM: number,
): readonly ChordRef[] {
  const refs: ChordRef[] = [];

  for (const item of itemsNear(index.grid, x, z, rangeM)) {
    const ref = index.chords[item];

    if (ref !== undefined) refs.push(ref);
  }

  return refs;
}

/** A chord start is a local distance minimum when the previous chord also ends there. */
function isStartMinimum(line: RoadLine, chord: number, x: number, z: number): boolean {
  if (chord === 0 && !line.loop) return true;

  const previous = chord === 0 ? line.points.length - 2 : chord - 1;

  return footOn(line, previous, x, z).t >= 1;
}

/** Whether the foot point on this chord is a local minimum of the distance to the line. */
function isCandidate(ref: ChordRef, foot: Foot, x: number, z: number): boolean {
  const { line, chord } = ref;

  if (foot.t > 0 && foot.t < 1) return true;

  if (foot.t <= 0) return isStartMinimum(line, chord, x, z);

  return chord === line.points.length - 2 && !line.loop;
}

/** Road profile height at the foot point, sunk by ROAD_SINK_M; exact on a constant grade. */
function floorOn(ref: ChordRef, foot: Foot): number {
  const a = point(ref.line, ref.chord);
  const b = point(ref.line, ref.chord + 1);

  return a.y + foot.t * (b.y - a.y) - ROAD_SINK_M;
}

/**
 * One candidate per road branch passing within rangeM: the local minima of the distance to
 * each centerline. A hairpin yields two candidates, a straight road one.
 */
export function corridorCandidates(
  index: CorridorIndex,
  x: number,
  z: number,
  rangeM = CORRIDOR_RANGE_M,
): readonly CorridorCandidate[] {
  const candidates: CorridorCandidate[] = [];

  for (const ref of chordsNear(index, x, z, rangeM)) {
    const foot = footOn(ref.line, ref.chord, x, z);

    if (foot.distanceM < rangeM && isCandidate(ref, foot, x, z)) {
      candidates.push({ distanceM: foot.distanceM, floorM: floorOn(ref, foot) });
    }
  }

  return candidates;
}

/** Distance to the nearest drawn centerline within rangeM, or Infinity. */
export function nearestRoadM(index: CorridorIndex, x: number, z: number, rangeM: number): number {
  return Math.min(
    Number.POSITIVE_INFINITY,
    ...chordsNear(index, x, z, rangeM).map((ref) => footOn(ref.line, ref.chord, x, z).distanceM),
  );
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));

  return t * t * (3 - 2 * t);
}

/**
 * Flattens the natural ground with every corridor candidate. Higher floors blend first and the
 * lowest last, so where corridors overlap the lower road wins; every candidate also caps the
 * ground, the lowest cap winning as well.
 */
export function corridorHeight(naturalM: number, candidates: readonly CorridorCandidate[]): number {
  let heightM = naturalM;
  let capM = Number.POSITIVE_INFINITY;

  const ordered =
    candidates.length > 1 ? candidates.toSorted((a, b) => b.floorM - a.floorM) : candidates;

  for (const candidate of ordered) {
    const weight = 1 - smoothstep((candidate.distanceM - EMBANKMENT_FLAT_M) / EMBANKMENT_BLEND_M);
    const bankM = CAP_SLOPE * Math.max(0, candidate.distanceM - CAP_FLAT_M);

    heightM += weight * (candidate.floorM - heightM);
    capM = Math.min(capM, candidate.floorM + bankM);
  }

  return Math.min(heightM, capM);
}
