import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import {
  lakeRadius,
  offsetPosition,
  terrainPosition,
  type LandscapePlan,
} from "./landscape-plan.js";
import { planWaymarks } from "./waymark-plan.js";

/** Lateral distance of a billboard center from the road centerline. */
export const BILLBOARD_LATERAL_M = 10.5;

/** Henry's decision on #42: three billboards per kilometre. */
export const BILLBOARDS_PER_KM = 3;

/** Placeholder motifs rotate in route order: every board shows the next one (#42). */
export const BILLBOARD_VARIANTS = 3;

/** Board size; each motif in the atlas keeps the same 2:1 aspect. */
export const BILLBOARD_WIDTH_M = 4;
export const BILLBOARD_HEIGHT_M = 2;

/** How far the board turns from facing straight down the road towards the rider's lane. */
const TOE_IN_RAD = Math.PI / 6;

/** Priority spots: start/finish and just outside every sprint/KOM segment. */
const START_FINISH_M = 20;
const SEGMENT_LEAD_M = 25;

/** A blocked slot may move this far along the route before it is skipped. */
const MAX_SHIFT_M = 40;
const SHIFT_STEP_M = 5;
const WAYMARK_CLEARANCE_M = 40;
const LAKE_CLEARANCE = 1.3;

export type BillboardSide = -1 | 1;

export interface Billboard {
  readonly routeDistanceM: number;
  readonly side: BillboardSide;
  /** Index into the motif atlas; rotates 0, 1, 2, 0, … in route order. */
  readonly variant: number;
  /** Ground point below the board center. */
  readonly position: WorldPos;
  /** Three.js yaw so the board's +z face points at riders approaching on the route. */
  readonly yawRad: number;
}

export interface SkippedSlot {
  readonly distanceM: number;
  readonly side: BillboardSide;
  readonly reason: "lake" | "waymark";
}

export interface BillboardPlan {
  readonly billboards: readonly Billboard[];
  readonly skipped: readonly SkippedSlot[];
}

interface Slot {
  readonly distanceM: number;
  readonly side: BillboardSide;
}

type Plan = Pick<LandscapePlan, "route" | "lake">;

/** Number of grid slots: three per kilometre, rounded. */
export function billboardSlotCount(route: Pick<EngineRoute, "lengthM">): number {
  return Math.max(1, Math.round((route.lengthM * BILLBOARDS_PER_KM) / 1000));
}

function wrapDistanceM(route: Pick<EngineRoute, "lengthM" | "loop">, distanceM: number): number {
  if (route.loop) return ((distanceM % route.lengthM) + route.lengthM) % route.lengthM;

  return Math.min(route.lengthM - 1, Math.max(1, distanceM));
}

function routeGapM(route: Pick<EngineRoute, "lengthM" | "loop">, a: number, b: number): number {
  const gap = Math.abs(a - b);

  return route.loop ? Math.min(gap, route.lengthM - gap) : gap;
}

function priorityDistances(route: EngineRoute): readonly number[] {
  const distances = [START_FINISH_M];

  if (!route.loop) distances.push(route.lengthM - START_FINISH_M);

  for (const segment of route.segments) {
    if (segment.kind !== "lap")
      distances.push(segment.startM - SEGMENT_LEAD_M, segment.endM + SEGMENT_LEAD_M);
  }

  return distances.map((distanceM) => wrapDistanceM(route, distanceM));
}

function nearestFreeSlot(
  route: EngineRoute,
  distances: readonly number[],
  claimed: readonly number[],
  priorityM: number,
): number | undefined {
  let best: number | undefined;
  let bestGapM = Number.POSITIVE_INFINITY;

  for (const [index, distanceM] of distances.entries()) {
    const gapM = routeGapM(route, distanceM, priorityM);

    if (!claimed.includes(index) && gapM < bestGapM) {
      best = index;
      bestGapM = gapM;
    }
  }

  return best;
}

/** Evenly spaced slots on alternating sides; each priority spot claims its nearest free slot. */
function gridSlots(route: EngineRoute): readonly Slot[] {
  const count = billboardSlotCount(route);
  const spacingM = route.lengthM / count;
  const offsetM = route.loop ? 0 : spacingM / 2;

  const distances = Array.from({ length: count }, (_, index) => offsetM + index * spacingM);
  const claimed: number[] = [];

  for (const priorityM of priorityDistances(route)) {
    const free = nearestFreeSlot(route, distances, claimed, priorityM);

    if (free !== undefined) {
      claimed.push(free);
      distances[free] = priorityM;
    }
  }

  return distances.map((distanceM, index) => ({ distanceM, side: index % 2 === 0 ? 1 : -1 }));
}

function blockedBy(plan: Plan, slot: Slot): SkippedSlot["reason"] | undefined {
  const spot = offsetPosition(plan.route, slot.distanceM, slot.side * BILLBOARD_LATERAL_M);

  if (lakeRadius(plan.lake, spot) < LAKE_CLEARANCE) return "lake";

  const nearWaymark = planWaymarks(plan.route).some(
    (waymark) =>
      Math.sign(waymark.lateralM) === slot.side &&
      routeGapM(plan.route, waymark.distanceM, slot.distanceM) < WAYMARK_CLEARANCE_M,
  );

  return nearWaymark ? "waymark" : undefined;
}

/** Tries 0, +5, −5, +10, … ±40 m; the first unblocked position wins. */
function shiftedSlot(plan: Plan, slot: Slot): Slot | SkippedSlot {
  const reason = blockedBy(plan, slot);

  if (reason === undefined) return slot;

  for (let shiftM = SHIFT_STEP_M; shiftM <= MAX_SHIFT_M; shiftM += SHIFT_STEP_M) {
    for (const direction of [1, -1]) {
      const moved = {
        ...slot,
        distanceM: wrapDistanceM(plan.route, slot.distanceM + direction * shiftM),
      };

      if (blockedBy(plan, moved) === undefined) return moved;
    }
  }

  return { ...slot, reason };
}

function yawFor(route: EngineRoute, slot: Slot): number {
  const headingRad = route.headingRad(slot.distanceM);
  const forward = { x: Math.cos(headingRad), z: Math.sin(headingRad) };
  const lateral = { x: -Math.sin(headingRad), z: Math.cos(headingRad) };
  const normalX = -Math.cos(TOE_IN_RAD) * forward.x - slot.side * Math.sin(TOE_IN_RAD) * lateral.x;
  const normalZ = -Math.cos(TOE_IN_RAD) * forward.z - slot.side * Math.sin(TOE_IN_RAD) * lateral.z;

  return Math.atan2(normalX, normalZ);
}

/**
 * Deterministic roadside billboards (spec E8-02): three slots per kilometre on
 * alternating sides, priority spots pulled into the grid, blocked slots shifted
 * up to 40 m or reported as skipped, motif variants rotating in route order.
 */
export function planBillboards(plan: Plan): BillboardPlan {
  const placed: Slot[] = [];
  const skipped: SkippedSlot[] = [];

  for (const slot of gridSlots(plan.route)) {
    const result = shiftedSlot(plan, slot);

    if ("reason" in result) skipped.push(result);
    else placed.push(result);
  }

  const billboards = placed
    .toSorted((a, b) => a.distanceM - b.distanceM)
    .map((slot, index) => ({
      routeDistanceM: slot.distanceM,
      side: slot.side,
      variant: index % BILLBOARD_VARIANTS,
      position: terrainPosition(plan, slot.distanceM, slot.side * BILLBOARD_LATERAL_M),
      yawRad: yawFor(plan.route, slot),
    }));

  return { billboards, skipped };
}
