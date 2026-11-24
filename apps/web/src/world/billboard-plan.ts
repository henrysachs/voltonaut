import type { WorldPos } from "@voltonaut/engine";

import {
  lakeRadius,
  offsetPosition,
  terrainPosition,
  type LandscapePlan,
} from "./landscape-plan.js";

/** Lateral distance of a billboard center from the road centerline. */
export const BILLBOARD_LATERAL_M = 10.5;

/** Spacing of the regular billboards between the focal spots. */
export const BILLBOARD_SPACING_M = 500;

/** Board size; the motif texture keeps the same 2:1 aspect. */
export const BILLBOARD_WIDTH_M = 4;
export const BILLBOARD_HEIGHT_M = 2;

/** How far the board turns from facing straight down the road towards the rider's lane. */
const TOE_IN_RAD = Math.PI / 6;

/** Regular billboards keep this distance from focal pairs so spots do not pile up. */
const FOCAL_CLEARANCE_M = 80;

/** Focal pairs stand this far before a segment start and after a segment end. */
const SEGMENT_LEAD_M = 25;

const START_FINISH_M = 20;

/** Waymark signs from waymarks.ts: left side, every kilometre plus 30 m. */
const WAYMARK_OFFSET_M = 30;
const WAYMARK_CLEARANCE_M = 12;

const LAKE_CLEARANCE = 1.25;

export type BillboardSide = -1 | 1;

export interface Billboard {
  readonly routeDistanceM: number;
  readonly side: BillboardSide;
  /** Ground point below the board center. */
  readonly position: WorldPos;
  /** Three.js yaw so the board's +z face points at riders approaching on the route. */
  readonly yawRad: number;
}

interface Spot {
  readonly distanceM: number;
  readonly side: BillboardSide;
}

function focalDistances(plan: Pick<LandscapePlan, "route">): readonly number[] {
  const { route } = plan;
  const distances = [START_FINISH_M];

  if (!route.loop) distances.push(route.lengthM - START_FINISH_M);

  for (const segment of route.segments) {
    distances.push(segment.startM - SEGMENT_LEAD_M, segment.endM + SEGMENT_LEAD_M);
  }

  return distances;
}

function wrapDistanceM(plan: Pick<LandscapePlan, "route">, distanceM: number): number {
  const { lengthM, loop } = plan.route;

  if (loop) return ((distanceM % lengthM) + lengthM) % lengthM;

  return Math.min(lengthM - 1, Math.max(1, distanceM));
}

function routeGapM(plan: Pick<LandscapePlan, "route">, a: number, b: number): number {
  const gap = Math.abs(a - b);

  return plan.route.loop ? Math.min(gap, plan.route.lengthM - gap) : gap;
}

function candidateSpots(plan: Pick<LandscapePlan, "route">): readonly Spot[] {
  const focal = focalDistances(plan).map((distanceM) => wrapDistanceM(plan, distanceM));

  const spots: Spot[] = focal.flatMap((distanceM) => [
    { distanceM, side: -1 as const },
    { distanceM, side: 1 as const },
  ]);

  let index = 0;

  for (
    let distanceM = BILLBOARD_SPACING_M / 2;
    distanceM < plan.route.lengthM;
    distanceM += BILLBOARD_SPACING_M
  ) {
    const side: BillboardSide = index % 2 === 0 ? 1 : -1;

    index += 1;

    if (focal.some((focalM) => routeGapM(plan, focalM, distanceM) < FOCAL_CLEARANCE_M)) continue;

    spots.push({ distanceM, side });
  }

  return spots;
}

/** Moves left-side spots off the kilometre waymark signs. */
function clearOfWaymarks(plan: Pick<LandscapePlan, "route">, spot: Spot): Spot {
  if (spot.side !== -1) return spot;

  const kmOffsetM = (spot.distanceM - WAYMARK_OFFSET_M) % 1000;
  const nearestWaymarkM = spot.distanceM - kmOffsetM + (kmOffsetM > 500 ? 1000 : 0);

  if (Math.abs(spot.distanceM - nearestWaymarkM) >= WAYMARK_CLEARANCE_M) return spot;

  const direction = spot.distanceM < nearestWaymarkM ? -1 : 1;

  return {
    ...spot,
    distanceM: wrapDistanceM(plan, nearestWaymarkM + direction * WAYMARK_CLEARANCE_M),
  };
}

function yawFor(plan: Pick<LandscapePlan, "route">, spot: Spot): number {
  const headingRad = plan.route.headingRad(spot.distanceM);
  const forward = { x: Math.cos(headingRad), z: Math.sin(headingRad) };
  const lateral = { x: -Math.sin(headingRad), z: Math.cos(headingRad) };
  const normalX = -Math.cos(TOE_IN_RAD) * forward.x - spot.side * Math.sin(TOE_IN_RAD) * lateral.x;
  const normalZ = -Math.cos(TOE_IN_RAD) * forward.z - spot.side * Math.sin(TOE_IN_RAD) * lateral.z;

  return Math.atan2(normalX, normalZ);
}

/**
 * Deterministic roadside billboard spots: a pair at start/finish and around every
 * sprint/KOM segment, plus one board every 500 m on alternating sides. Boards
 * avoid the left-side kilometre waymarks and the lake.
 */
export function planBillboards(plan: Pick<LandscapePlan, "route" | "lake">): readonly Billboard[] {
  const billboards: Billboard[] = [];

  for (const candidate of candidateSpots(plan)) {
    const spot = clearOfWaymarks(plan, candidate);
    const lateralM = spot.side * BILLBOARD_LATERAL_M;

    if (
      lakeRadius(plan.lake, offsetPosition(plan.route, spot.distanceM, lateralM)) < LAKE_CLEARANCE
    ) {
      continue;
    }

    billboards.push({
      routeDistanceM: spot.distanceM,
      side: spot.side,
      position: terrainPosition(plan, spot.distanceM, lateralM),
      yawRad: yawFor(plan, spot),
    });
  }

  return billboards.toSorted((a, b) => a.routeDistanceM - b.routeDistanceM || a.side - b.side);
}
