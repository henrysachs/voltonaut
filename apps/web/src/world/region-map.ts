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

/** Every n-th centerline point is enough to place a 600 m blend. */
const POINT_STRIDE = 5;

/** Region weights are reused within squares of this size; a 600 m blend needs no finer. */
const MEMO_M = 64;
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

    const points = road.centerline.filter(
      (_, index) => index % POINT_STRIDE === 0 || index === road.centerline.length - 1,
    );

    for (const point of points) {
      const key = cellKey(Math.floor(point.x / CELL_M), Math.floor(point.z / CELL_M));
      const cell = cells.get(key) ?? [];

      cell.push({ x: point.x, z: point.z, region });
      cells.set(key, cell);
    }
  }

  return { pointsIn: (key) => cells.get(key) ?? [] };
}

/** Cell offsets on the square ring at the given distance; ring 0 is the centre cell. */
function ringCells(ring: number): readonly (readonly [number, number])[] {
  if (ring === 0) return [[0, 0]];

  const side = Array.from({ length: 2 * ring + 1 }, (_, step) => step - ring);

  return [
    ...side.map((dc) => [dc, -ring] as const),
    ...side.map((dc) => [dc, ring] as const),
    ...side.slice(1, -1).map((dr) => [-ring, dr] as const),
    ...side.slice(1, -1).map((dr) => [ring, dr] as const),
  ];
}

/** Nearest road vertex distance per region, widened ring by ring from the point's cell. */
class RingSearch {
  readonly nearest: number[];
  private ring = 0;

  constructor(
    private readonly grid: Grid,
    count: number,
    private readonly x: number,
    private readonly z: number,
  ) {
    this.nearest = Array.from({ length: count }, () => Number.POSITIVE_INFINITY);
  }

  /** Scans rings up to the given one; points outside them lie at least (ring) cells away. */
  scanTo(lastRing: number): void {
    const column = Math.floor(this.x / CELL_M);
    const row = Math.floor(this.z / CELL_M);

    for (; this.ring <= lastRing; this.ring += 1) {
      for (const [dc, dr] of ringCells(this.ring)) {
        for (const point of this.grid.pointsIn(cellKey(column + dc, row + dr))) {
          const distanceM = Math.hypot(point.x - this.x, point.z - this.z);

          if (distanceM < (this.nearest[point.region] ?? 0)) this.nearest[point.region] = distanceM;
        }
      }
    }
  }

  /** Distance no unscanned point can undercut. */
  get reachM(): number {
    return (this.ring - 1) * CELL_M;
  }
}

/** Fade weights; outside every blend zone the nearest region alone. */
function weightsFrom(grid: Grid, count: number, x: number, z: number): readonly number[] {
  const search = new RingSearch(grid, count, x, z);

  search.scanTo(Math.ceil(REGION_BLEND_M / CELL_M) + 1);

  const raw = search.nearest.map((distanceM) => Math.max(0, 1 - distanceM / REGION_BLEND_M) ** 2);
  const total = raw.reduce((sum, weight) => sum + weight, 0);

  if (total > 0) return raw.map((weight) => weight / total);

  for (let ring = search.reachM / CELL_M + 2; ring <= MAX_RINGS; ring += 1) {
    if (Math.min(...search.nearest) <= search.reachM) break;
    search.scanTo(ring);
  }

  const winner = search.nearest.indexOf(Math.min(...search.nearest));

  return search.nearest.map((_, index) => (index === Math.max(0, winner) ? 1 : 0));
}

/**
 * Region map of a world in the given region order. A world with one region weighs every point
 * fully to it; otherwise weights are computed once per 64 m square.
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
