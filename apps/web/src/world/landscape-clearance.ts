import type { EngineRoute } from "@voltonaut/engine";

/** Terrain rows are 10 m apart; the route is probed twice as densely. */
const ROW_STEP_M = 10;
const PROBE_STEP_M = 5;

/**
 * A foreign road point counts for a row when it lies this close to the row's lateral line: one row
 * step plus half a road, so the triangles between two rows cannot reach over it either.
 */
const ALONG_TOLERANCE_M = ROW_STEP_M + 6;

/**
 * Road within this route distance of a row is the row's own road. Just above the along tolerance,
 * so a straight road never limits itself while the leg behind a hairpin already counts as foreign.
 */
const OWN_ROAD_M = ALONG_TOLERANCE_M + 4;

/** Kept free beside a foreign road centerline: half the road plus a shoulder. */
const ROAD_CLEARANCE_M = 10;

interface ClearanceTable {
  readonly stepM: number;
  /** Free lateral space per row to the left (negative offsets) and right (positive offsets). */
  readonly left: Float64Array;
  readonly right: Float64Array;
}

const TABLES = new WeakMap<EngineRoute, ClearanceTable>();

function routeGap(route: EngineRoute, aM: number, bM: number): number {
  const gapM = Math.abs(aM - bM);

  return route.loop ? Math.min(gapM, route.lengthM - gapM) : gapM;
}

interface Probe {
  readonly distanceM: number;
  readonly x: number;
  readonly z: number;
}

function probes(route: EngineRoute): readonly Probe[] {
  const points: Probe[] = [];

  for (let distanceM = 0; distanceM <= route.lengthM; distanceM += PROBE_STEP_M) {
    const { x, z } = route.worldPos(distanceM);

    points.push({ distanceM, x, z });
  }

  return points;
}

/** Terrain never reaches further than its widest offset; farther road cannot be covered. */
const MAX_REACH_M = 360 + ROAD_CLEARANCE_M;
const CELL_M = 32;

function cellKey(x: number, z: number): number {
  return Math.floor(x / CELL_M) * 1_000_003 + Math.floor(z / CELL_M);
}

/** Road probes bucketed by grid cell, so each row only looks at road near its lateral line. */
function probeGrid(points: readonly Probe[]): ReadonlyMap<number, readonly Probe[]> {
  const grid = new Map<number, Probe[]>();

  for (const point of points) {
    const key = cellKey(point.x, point.z);
    const bucket = grid.get(key) ?? [];

    bucket.push(point);
    grid.set(key, bucket);
  }

  return grid;
}

/** The probes in every cell a band of ±ALONG_TOLERANCE_M around the row's lateral line touches. */
function nearLateralLine(
  grid: Readonly<ReadonlyMap<number, readonly Probe[]>>,
  center: Readonly<{ x: number; z: number }>,
  forward: Readonly<{ x: number; z: number }>,
): readonly Probe[] {
  const keys = new Set<number>();

  for (let acrossM = -MAX_REACH_M; acrossM <= MAX_REACH_M; acrossM += CELL_M / 2)
    for (const alongM of [-ALONG_TOLERANCE_M, 0, ALONG_TOLERANCE_M])
      keys.add(
        cellKey(
          center.x + forward.x * alongM - forward.z * acrossM,
          center.z + forward.z * alongM + forward.x * acrossM,
        ),
      );

  return [...keys].flatMap((key) => grid.get(key) ?? []);
}

function buildTable(route: EngineRoute): ClearanceTable {
  const rowCount = Math.ceil(route.lengthM / ROW_STEP_M) + 1;
  const stepM = route.lengthM / (rowCount - 1);
  const left = new Float64Array(rowCount).fill(Infinity);
  const right = new Float64Array(rowCount).fill(Infinity);
  const grid = probeGrid(probes(route));

  for (let row = 0; row < rowCount; row += 1) {
    const distanceM = row * stepM;
    const center = route.worldPos(distanceM);
    const heading = route.headingRad(distanceM);
    const forward = { x: Math.cos(heading), z: Math.sin(heading) };

    for (const point of nearLateralLine(grid, center, forward)) {
      if (routeGap(route, point.distanceM, distanceM) <= OWN_ROAD_M) continue;

      const dx = point.x - center.x;
      const dz = point.z - center.z;

      if (Math.abs(dx * forward.x + dz * forward.z) > ALONG_TOLERANCE_M) continue;

      // Lateral axis as in offsetPosition: (-sin, cos) of the heading.
      const acrossM = -dx * forward.z + dz * forward.x;
      const freeM = Math.max(0, Math.abs(acrossM) - ROAD_CLEARANCE_M);

      if (acrossM < 0) left[row] = Math.min(left[row] ?? Infinity, freeM);
      else right[row] = Math.min(right[row] ?? Infinity, freeM);
    }
  }

  return { stepM, left, right };
}

/**
 * How far terrain may reach sideways at a route distance before it would cover another leg of
 * the same road, e.g. the next switchback of a pass. The limit spreads `spreadRows` rows each way
 * (one by default): a collapsed row beside a full one would tilt their shared triangles over the
 * road edge.
 */
export function roadClearanceM(
  route: EngineRoute,
  distanceM: number,
  lateralM: number,
  spreadRows = 1,
): number {
  let table = TABLES.get(route);

  if (table === undefined) {
    table = buildTable(route);
    TABLES.set(route, table);
  }

  const side = lateralM < 0 ? table.left : table.right;
  const position = Math.min(Math.max(distanceM / table.stepM, 0), side.length - 1);
  let limitM = Infinity;

  for (
    let row = Math.floor(position) - spreadRows;
    row <= Math.ceil(position) + spreadRows;
    row += 1
  )
    limitM = Math.min(limitM, side[row] ?? Infinity);

  return limitM;
}

const ROW_VALUES = new WeakMap<EngineRoute, Map<string, Float64Array>>();

/**
 * A value per terrain row, computed once per route. Terrain rows, their neighbours and plants
 * ask for the same row distances again and again before the first frame (#138 review). Distances
 * between rows are computed directly.
 */
export function rowValue(
  route: EngineRoute,
  name: string,
  distanceM: number,
  compute: (distanceM: number) => number,
): number {
  const rowCount = Math.ceil(route.lengthM / ROW_STEP_M) + 1;
  const position = distanceM / (route.lengthM / (rowCount - 1));
  const row = Math.round(position);

  if (Math.abs(position - row) > 1e-9 || row < 0 || row >= rowCount) return compute(distanceM);

  let tables = ROW_VALUES.get(route);

  if (tables === undefined) {
    tables = new Map();
    ROW_VALUES.set(route, tables);
  }

  let table = tables.get(name);

  if (table === undefined) {
    table = new Float64Array(rowCount).fill(Number.NaN);
    tables.set(name, table);
  }

  const known = table[row] ?? Number.NaN;

  if (!Number.isNaN(known)) return known;

  const value = compute(distanceM);

  table[row] = value;

  return value;
}
