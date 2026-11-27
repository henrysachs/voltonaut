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

/** The far field reaches this many cells beyond the outermost road cells. */
const FAR_MARGIN_CELLS = 32;

interface GridPoint {
  readonly x: number;
  readonly z: number;
  readonly region: number;
}

interface FarCell {
  readonly region: number;
  readonly steps: number;
}

interface Grid {
  readonly pointsIn: (key: number) => readonly GridPoint[];
  /** Nearest road cell's region and its distance in 4-neighbour cell steps. */
  readonly far: (column: number, row: number) => FarCell;
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

  return {
    pointsIn: (key) => cells.get(key) ?? [],
    far: farField((key) => cells.get(key) ?? [], [...cells.keys()]),
  };
}

/** Region of the point nearest a cell's centre among the cell's own road points. */
function cellRegion(points: readonly GridPoint[], column: number, row: number): number {
  const centerX = (column + 0.5) * CELL_M;
  const centerZ = (row + 0.5) * CELL_M;
  let best = points[0];

  for (const point of points) {
    const distanceM = Math.hypot(point.x - centerX, point.z - centerZ);
    const bestM = Math.hypot((best?.x ?? 0) - centerX, (best?.z ?? 0) - centerZ);

    if (distanceM < bestM) best = point;
  }

  return best?.region ?? 0;
}

interface Sweep {
  readonly regions: Int16Array;
  readonly steps: Int32Array;
  readonly width: number;
  readonly height: number;
}

/** Breadth-first fill from the queued road cells: each empty cell takes its first neighbour. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The typed arrays and the queue are filled in place while the sweep runs.
function sweep({ regions, steps, width, height }: Sweep, queue: number[]): void {
  for (let head = 0; head < queue.length; head += 1) {
    const slot = queue[head] ?? 0;
    const x = slot % width;
    const y = Math.floor(slot / width);

    const neighbours = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const;

    for (const [nx, ny] of neighbours) {
      const next = ny * width + nx;

      if (nx >= 0 && ny >= 0 && nx < width && ny < height && regions[next] === -1) {
        regions[next] = regions[slot] ?? 0;
        steps[next] = (steps[slot] ?? 0) + 1;
        queue.push(next);
      }
    }
  }
}

/**
 * Nearest region per cell by a breadth-first sweep from every road cell (4-neighbour steps).
 * Far from all roads only the nearest region shows, so cell accuracy is enough; cells beyond
 * the swept area take the nearest swept cell.
 */
function farField(
  cellsAt: (key: number) => readonly GridPoint[],
  keys: readonly number[],
): (column: number, row: number) => FarCell {
  const columns = keys.map((key) => Math.round(key / 131_072));
  const rows = keys.map((key, index) => key - (columns[index] ?? 0) * 131_072);
  const minColumn = Math.min(...columns) - FAR_MARGIN_CELLS;
  const minRow = Math.min(...rows) - FAR_MARGIN_CELLS;
  const width = Math.max(...columns) + FAR_MARGIN_CELLS - minColumn + 1;
  const height = Math.max(...rows) + FAR_MARGIN_CELLS - minRow + 1;
  const regions = new Int16Array(width * height).fill(-1);
  const steps = new Int32Array(width * height);
  const queue: number[] = [];

  for (const [index, key] of keys.entries()) {
    const column = columns[index] ?? 0;
    const row = rows[index] ?? 0;
    const slot = (row - minRow) * width + column - minColumn;

    regions[slot] = cellRegion(cellsAt(key), column, row);
    queue.push(slot);
  }

  sweep({ regions, steps, width, height }, queue);

  return (column, row) => {
    const x = Math.min(width - 1, Math.max(0, column - minColumn));
    const y = Math.min(height - 1, Math.max(0, row - minRow));
    const outside = Math.abs(column - minColumn - x) + Math.abs(row - minRow - y);

    return {
      region: regions[y * width + x] ?? 0,
      steps: (steps[y * width + x] ?? 0) + outside,
    };
  };
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
}

/** Fade weights; outside every blend zone the nearest region alone. */
function weightsFrom(grid: Grid, count: number, x: number, z: number): readonly number[] {
  const blendRings = Math.ceil(REGION_BLEND_M / CELL_M) + 1;
  const far = grid.far(Math.floor(x / CELL_M), Math.floor(z / CELL_M));

  // Beyond 2 · blendRings Manhattan steps no road point lies within the blend distance.
  if (far.steps > 2 * blendRings) return oneHot(count, far.region);

  const search = new RingSearch(grid, count, x, z);

  search.scanTo(blendRings);

  const raw = search.nearest.map((distanceM) => Math.max(0, 1 - distanceM / REGION_BLEND_M) ** 2);
  const total = raw.reduce((sum, weight) => sum + weight, 0);

  if (total > 0) return raw.map((weight) => weight / total);

  return oneHot(count, far.region);
}

const oneHots = new Map<string, readonly number[]>();

/** Shared weights giving one region everything. */
function oneHot(count: number, region: number): readonly number[] {
  const key = `${count}:${region}`;
  const known = oneHots.get(key);

  if (known !== undefined) return known;

  const weights = Array.from({ length: count }, (_, index) => (index === region ? 1 : 0));

  oneHots.set(key, weights);

  return weights;
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
