import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import { roadClearanceM } from "./landscape-clearance.js";

export const TERRAIN_OFFSETS_M = [
  -360, -240, -160, -120, -100, -90, -80, -76, -72, -68, -64, -60, -56, -52, -48, -44, -40, -36,
  -32, -28, -24, -20, -16, -10, -6, -4, 0, 4, 6, 10, 16, 24, 36, 50, 70, 100, 160, 240, 360,
];

export interface Lake {
  readonly center: WorldPos;
  readonly headingRad: number;
  readonly alongRadiusM: number;
  readonly acrossRadiusM: number;
  readonly waterYM: number;
}

export interface Plant {
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
  readonly trees: readonly Plant[];
  readonly rocks: readonly Plant[];
}

export function offsetPosition(route: EngineRoute, distanceM: number, lateralM: number): WorldPos {
  const position = route.worldPos(distanceM);
  const heading = route.headingRad(distanceM);

  return {
    x: position.x - Math.sin(heading) * lateralM,
    y: position.y,
    z: position.z + Math.cos(heading) * lateralM,
  };
}

const TURN_WINDOW_M = 20;

/** Up to two terrain rows (10 m each, see terrain.ts) on either side. */
const RELIEF_NEIGHBOURS_M = [-20, -10, 10, 20];
const MIN_TURN_RAD = 0.2;
const MAX_TURN_RAD = Math.PI / 2;

/** Signed heading change across the turn window; positive turns towards positive offsets. */
function turnAt(route: EngineRoute, distanceM: number): number {
  // Loops wrap across the lap line, so a turn at the seam is seen like any other.
  const beforeM = route.loop
    ? distanceM - TURN_WINDOW_M / 2
    : Math.max(0, distanceM - TURN_WINDOW_M / 2);
  const afterM = route.loop
    ? distanceM + TURN_WINDOW_M / 2
    : Math.min(route.lengthM, distanceM + TURN_WINDOW_M / 2);
  const beforeRad = route.headingRad(beforeM);
  const afterRad = route.headingRad(afterM);

  return Math.atan2(Math.sin(afterRad - beforeRad), Math.cos(afterRad - beforeRad));
}

/** Shrinks lateral terrain offsets at sharp turns so inner rows miss the previous leg. */
function cornerLateralM(route: EngineRoute, distanceM: number, lateralM: number): number {
  const turnRad = Math.abs(turnAt(route, distanceM));

  const blend =
    turnRad <= MIN_TURN_RAD
      ? 1
      : Math.max(0, 1 - (turnRad - MIN_TURN_RAD) / (MAX_TURN_RAD - MIN_TURN_RAD));

  // Never across another leg of the same road, e.g. the next switchback (#138 review).
  const reachM = Math.min(Math.abs(lateralM * blend), roadClearanceM(route, distanceM, lateralM));

  return Math.sign(lateralM) * reachM;
}

/** Whether an offset lies on the inside of a sharp turn, where the rows fold back. */
function insideTurn(route: EngineRoute, distanceM: number, lateralM: number): boolean {
  const turnRad = turnAt(route, distanceM);

  return (
    lateralM !== 0 && Math.abs(turnRad) > MIN_TURN_RAD && Math.sign(lateralM) === Math.sign(turnRad)
  );
}

/**
 * On the inside of a sharp turn the rows fold back over road already ridden; on a climb that
 * road is lower than the row. The inner side therefore rests on the lowest neighbouring road
 * height. The road's own centre line keeps its height.
 */
function cornerBaseY(route: EngineRoute, distanceM: number, roadY: number): number {
  return Math.min(
    roadY,
    route.worldPos(distanceM - TURN_WINDOW_M / 2).y,
    route.worldPos(distanceM + TURN_WINDOW_M / 2).y,
  );
}

export function lakeRadius(lake: Lake, position: WorldPos): number {
  const dx = position.x - lake.center.x;
  const dz = position.z - lake.center.z;
  const alongM = dx * Math.cos(lake.headingRad) + dz * Math.sin(lake.headingRad);
  const acrossM = -dx * Math.sin(lake.headingRad) + dz * Math.cos(lake.headingRad);

  return Math.hypot(alongM / lake.alongRadiusM, acrossM / lake.acrossRadiusM);
}

export function terrainPosition(
  plan: Pick<LandscapePlan, "route" | "lake">,
  distanceM: number,
  lateralM: number,
): WorldPos {
  const effectiveLateralM = cornerLateralM(plan.route, distanceM, lateralM);
  const position = offsetPosition(plan.route, distanceM, effectiveLateralM);

  // Relief grows only as far as the neighbouring rows reach too; beside a pinched row a raised
  // vertex would tilt the shared triangles over the road edge.
  const reachM = Math.min(
    Math.abs(effectiveLateralM),
    ...RELIEF_NEIGHBOURS_M.map((offsetM) =>
      Math.abs(cornerLateralM(plan.route, distanceM + offsetM, lateralM)),
    ),
  );

  const inside = insideTurn(plan.route, distanceM, lateralM);
  // Folded inner rows get no relief; a raised vertex there would cover the road.
  const clearanceM = inside ? 0 : Math.max(0, reachM - 4);
  const blend = Math.min(1, clearanceM / 32);
  const phase = (distanceM / plan.route.lengthM) * Math.PI * 2;

  const reliefM =
    3 + 5 * Math.sin(phase * 20 + lateralM / 37) + 3 * Math.cos(phase * 11 - lateralM / 23);

  const baseY = inside ? cornerBaseY(plan.route, distanceM, position.y) : position.y;
  let y = baseY - 0.06 + blend * reliefM;

  const radius = lakeRadius(plan.lake, position);

  if (radius < 1.65 && Math.abs(effectiveLateralM) > 6) {
    const basinYM = plan.lake.waterYM - 2 + 2.2 * Math.min(radius, 1.18) ** 4;
    const shoreBlend = Math.max(0, (radius - 1.18) / 0.47);

    y = basinYM * (1 - shoreBlend) + y * shoreBlend;
  }

  return { ...position, y };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    return state / 4_294_967_296;
  };
}

function triangleHeight(
  position: WorldPos,
  a: WorldPos,
  b: WorldPos,
  c: WorldPos,
): number | undefined {
  const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  const u = ((b.z - c.z) * (position.x - c.x) + (c.x - b.x) * (position.z - c.z)) / determinant;
  const v = ((c.z - a.z) * (position.x - c.x) + (a.x - c.x) * (position.z - c.z)) / determinant;

  return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8
    ? u * a.y + v * b.y + (1 - u - v) * c.y
    : undefined;
}

function plantPosition(
  plan: Pick<LandscapePlan, "route" | "lake">,
  distanceM: number,
  lateralM: number,
): WorldPos {
  const effectiveLateralM = cornerLateralM(plan.route, distanceM, lateralM);
  const position = terrainPosition(plan, distanceM, lateralM);
  const stepM = plan.route.lengthM / Math.ceil(plan.route.lengthM / 10);
  const startM = Math.floor(distanceM / stepM) * stepM;

  for (const segmentM of [startM - stepM, startM, startM + stepM]) {
    for (const [index, leftM] of TERRAIN_OFFSETS_M.entries()) {
      const rightM = TERRAIN_OFFSETS_M[index + 1];

      if (rightM === undefined || effectiveLateralM < leftM - 1 || effectiveLateralM > rightM + 1) {
        continue;
      }

      const a = terrainPosition(plan, segmentM, leftM);
      const b = terrainPosition(plan, segmentM, rightM);
      const c = terrainPosition(plan, segmentM + stepM, leftM);
      const d = terrainPosition(plan, segmentM + stepM, rightM);
      const y = triangleHeight(position, a, b, c) ?? triangleHeight(position, b, d, c);

      if (y !== undefined) {
        return { ...position, y };
      }
    }
  }

  return position;
}

/**
 * Deterministic landscape placement for a route. Without a lake (alpine pass,
 * night city) the plan uses a 1 m pond 58 m off the road, far outside every
 * terrain offset and plant row, so no basin or shore is ever carved. The coast
 * keeps a small lagoon beside the open sea.
 */
export function createLandscapePlan(route: EngineRoute, seed = 42, withLake = true): LandscapePlan {
  const lake: Lake = {
    center: offsetPosition(route, 110, -58),
    headingRad: route.headingRad(110),
    alongRadiusM: withLake ? 148 : 1,
    acrossRadiusM: withLake ? 44 : 1,
    waterYM: route.worldPos(110).y - 1.4,
  };

  const random = seededRandom(seed);

  const trees: Plant[] = [];
  const rocks: Plant[] = [];
  const plan = { route, lake };

  for (let distanceM = 0; distanceM < route.lengthM; distanceM += 24) {
    for (const side of [-1, 1]) {
      for (const row of distanceM < 650 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2]) {
        const alongM = Math.min(route.lengthM - 0.01, distanceM + random() * 18);
        const lateralM = side * (13 + row * 24 + random() * 14);
        const position = plantPosition(plan, alongM, lateralM);
        const shade = random();
        const heightM = 7 + random() * 7;
        const rotationRad = random() * Math.PI * 2;
        const plant = { routeDistanceM: alongM, position, heightM, rotationRad, shade };

        if (lakeRadius(lake, position) < 1.2) {
          continue;
        }

        if (distanceM < 650 || shade > 0.35) {
          trees.push({ ...plant, radiusM: 1.7 + shade });
        } else {
          rocks.push({ ...plant, radiusM: 0.7 + shade * 2, heightM: 1 });
        }
      }
    }
  }

  return { ...plan, trees, rocks };
}
