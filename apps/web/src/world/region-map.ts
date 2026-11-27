/** A road chord list tagged with its region (ADR-033 §6). */
export interface RegionRoad {
  readonly regionId: string;
  readonly centerline: readonly { readonly x: number; readonly z: number }[];
}

/**
 * Region weights for any world point. Regions take over across a blend zone around their
 * border instead of switching at a line; weights sum to 1 and follow the regions' order.
 */
export interface RegionMap {
  readonly regionIds: readonly string[];
  readonly weightsAt: (x: number, z: number) => readonly number[];
}

/** Distance over which a region fades out beyond its own roads. */
export const REGION_BLEND_M = 600;

const CELL_M = 200;

/** Region weights are reused within squares of this size; colours and plants need no finer. */
const MEMO_M = 16;
const MAX_RINGS = 64;

interface GridPoint {
  readonly x: number;
  readonly z: number;
  readonly region: number;
}

interface Grid {
  readonly pointsIn: (key: number) => readonly GridPoint[];
}

function cellKey(column: number, row: number): number {
  return column * 131_072 + row;
}

function buildGrid(roads: readonly RegionRoad[], regionIds: readonly string[]): Grid {
  const cells = new Map<number, { x: number; z: number; region: number }[]>();

  for (const road of roads) {
    const region = regionIds.indexOf(road.regionId);

    for (const point of road.centerline) {
      const key = cellKey(Math.floor(point.x / CELL_M), Math.floor(point.z / CELL_M));
      const cell = cells.get(key) ?? [];

      cell.push({ x: point.x, z: point.z, region });
      cells.set(key, cell);
    }
  }

  return { pointsIn: (key) => cells.get(key) ?? [] };
}

/** Nearest road vertex distance per region within the given rings around the point's cell. */
function nearestPerRegion(
  grid: Grid,
  count: number,
  x: number,
  z: number,
  rings: number,
): number[] {
  const nearest = Array.from({ length: count }, () => Number.POSITIVE_INFINITY);
  const column = Math.floor(x / CELL_M);
  const row = Math.floor(z / CELL_M);

  for (let dc = -rings; dc <= rings; dc += 1) {
    for (let dr = -rings; dr <= rings; dr += 1) {
      for (const point of grid.pointsIn(cellKey(column + dc, row + dr))) {
        const distanceM = Math.hypot(point.x - x, point.z - z);

        if (distanceM < (nearest[point.region] ?? 0)) nearest[point.region] = distanceM;
      }
    }
  }

  return nearest;
}

/** Fade weights; outside every blend zone the nearest region alone, found by widening rings. */
function weightsFrom(grid: Grid, count: number, x: number, z: number): readonly number[] {
  const blendRings = Math.ceil(REGION_BLEND_M / CELL_M) + 1;
  const near = nearestPerRegion(grid, count, x, z, blendRings);
  const raw = near.map((distanceM) => Math.max(0, 1 - distanceM / REGION_BLEND_M) ** 2);
  const total = raw.reduce((sum, weight) => sum + weight, 0);

  if (total > 0) return raw.map((weight) => weight / total);

  for (let rings = blendRings + 1; rings <= MAX_RINGS; rings += 1) {
    const far = nearestPerRegion(grid, count, x, z, rings);
    const best = Math.min(...far);

    const winner = far.indexOf(best);

    if (Number.isFinite(best)) return far.map((_, index) => (index === winner ? 1 : 0));
  }

  return raw.map((_, index) => (index === 0 ? 1 : 0));
}

/**
 * Region map of a world in the given region order. A world with one region weighs every point
 * fully to it; otherwise weights are computed once per 16 m square.
 */
export function createRegionMap(
  roads: readonly RegionRoad[],
  regionIds: readonly string[],
): RegionMap {
  if (regionIds.length <= 1) return { regionIds, weightsAt: () => [1] };

  const grid = buildGrid(roads, regionIds);
  const memo = new Map<number, readonly number[]>();

  return {
    regionIds,
    weightsAt: (x, z) => {
      const column = Math.floor(x / MEMO_M);
      const row = Math.floor(z / MEMO_M);
      const key = cellKey(column, row);
      const known = memo.get(key);

      if (known !== undefined) return known;

      const weights = weightsFrom(
        grid,
        regionIds.length,
        (column + 0.5) * MEMO_M,
        (row + 0.5) * MEMO_M,
      );

      memo.set(key, weights);

      return weights;
    },
  };
}

/** Index of the region with the largest weight; ties keep the earlier region. */
export function dominantRegion(map: RegionMap, x: number, z: number): number {
  const weights = map.weightsAt(x, z);

  return weights.reduce((best, weight, index) => (weight > (weights[best] ?? 0) ? index : best), 0);
}
