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

function buildTable(route: EngineRoute): ClearanceTable {
  const rowCount = Math.ceil(route.lengthM / ROW_STEP_M) + 1;
  const stepM = route.lengthM / (rowCount - 1);
  const left = new Float64Array(rowCount).fill(Infinity);
  const right = new Float64Array(rowCount).fill(Infinity);
  const roadPoints = probes(route);

  for (let row = 0; row < rowCount; row += 1) {
    const distanceM = row * stepM;
    const center = route.worldPos(distanceM);
    const heading = route.headingRad(distanceM);
    const forwardX = Math.cos(heading);
    const forwardZ = Math.sin(heading);

    for (const point of roadPoints) {
      if (routeGap(route, point.distanceM, distanceM) <= OWN_ROAD_M) continue;

      const dx = point.x - center.x;
      const dz = point.z - center.z;

      if (Math.abs(dx * forwardX + dz * forwardZ) > ALONG_TOLERANCE_M) continue;

      // Lateral axis as in offsetPosition: (-sin, cos) of the heading.
      const acrossM = -dx * forwardZ + dz * forwardX;
      const freeM = Math.max(0, Math.abs(acrossM) - ROAD_CLEARANCE_M);

      if (acrossM < 0) left[row] = Math.min(left[row] ?? Infinity, freeM);
      else right[row] = Math.min(right[row] ?? Infinity, freeM);
    }
  }

  return { stepM, left, right };
}

/**
 * How far terrain may reach sideways at a route distance before it would cover another leg of
 * the same road, e.g. the next switchback of a pass. The limit spreads one row each way: a
 * collapsed row beside a full one would tilt their shared triangles over the road edge.
 */
export function roadClearanceM(route: EngineRoute, distanceM: number, lateralM: number): number {
  let table = TABLES.get(route);

  if (table === undefined) {
    table = buildTable(route);
    TABLES.set(route, table);
  }

  const side = lateralM < 0 ? table.left : table.right;
  const position = Math.min(Math.max(distanceM / table.stepM, 0), side.length - 1);
  let limitM = Infinity;

  for (let row = Math.floor(position) - 1; row <= Math.ceil(position) + 1; row += 1)
    limitM = Math.min(limitM, side[row] ?? Infinity);

  return limitM;
}
