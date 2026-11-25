import { createRoute, FLAT_LOOP, KOM_CLIMB, TEST_LOOP, type EngineRoute } from "@voltonaut/engine";
import { expect, it } from "vitest";

import {
  BILLBOARD_CENTER_Y_M,
  BILLBOARD_HEIGHT_M,
  BILLBOARD_WIDTH_M,
  planBillboards,
  type Billboard,
} from "./billboard-plan.js";
import { cameraPose, type CameraMode, type PoseXyz } from "./camera.js";
import { createLandscapePlan } from "./landscape-plan.js";

const route = createRoute(TEST_LOOP);
const boards = planBillboards(createLandscapePlan(route)).billboards;

const allRoutes: readonly EngineRoute[] = [route, createRoute(FLAT_LOOP), createRoute(KOM_CLIMB)];

/** Extra room around each board for the easing lag of the follow camera. */
const LAG_MARGIN_M = 0.5;
const FRAME_M = 0.1;

const HALF_WIDTH_M = BILLBOARD_WIDTH_M / 2 + FRAME_M + LAG_MARGIN_M;
const TOP_M = BILLBOARD_CENTER_Y_M + BILLBOARD_HEIGHT_M / 2 + FRAME_M + LAG_MARGIN_M;
const BACK_M = -0.3 - LAG_MARGIN_M;
const FRONT_M = 0.05 + LAG_MARGIN_M;

interface Local {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A world point in the board frame: x along the board, y up from its ground point, z along its face normal. */
function toBoard(board: Billboard, point: PoseXyz): Local {
  const dx = point.x - board.position.x;
  const dz = point.z - board.position.z;

  return {
    x: dx * Math.cos(board.yawRad) - dz * Math.sin(board.yawRad),
    y: point.y - board.position.y,
    z: dx * Math.sin(board.yawRad) + dz * Math.cos(board.yawRad),
  };
}

/** Slab test of the segment a→b against the board's box (ground to top edge). */
function segmentHitsBoard(board: Billboard, from: PoseXyz, to: PoseXyz): boolean {
  const a = toBoard(board, from);
  const b = toBoard(board, to);

  const slabs: readonly (readonly [number, number, number, number])[] = [
    [a.x, b.x, -HALF_WIDTH_M, HALF_WIDTH_M],
    [a.y, b.y, 0, TOP_M],
    [a.z, b.z, BACK_M, FRONT_M],
  ];

  let enter = 0;
  let exit = 1;

  for (const [start, end, min, max] of slabs) {
    const delta = end - start;

    if (Math.abs(delta) < 1e-12) {
      if (start < min || start > max) return false;

      continue;
    }

    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;

    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
  }

  return enter <= exit;
}

/** "route@distance" every 2 m where the camera would sit in or look through a board. */
function blockedViews(mode: CameraMode, onRoute: EngineRoute): readonly string[] {
  const blocked: string[] = [];
  const routeBoards = planBillboards(createLandscapePlan(onRoute)).billboards;

  for (let distanceM = 0; distanceM < onRoute.lengthM; distanceM += 2) {
    const pose = cameraPose(mode, onRoute.worldPos(distanceM), onRoute.headingRad(distanceM));

    const near = routeBoards.filter(
      (board) =>
        Math.hypot(board.position.x - pose.position.x, board.position.z - pose.position.z) < 40,
    );

    const hit = near.some((board) => segmentHitsBoard(board, pose.position, pose.look));

    if (hit) blocked.push(`${onRoute.id}@${distanceM}`);
  }

  return blocked;
}

it("detects a board placed right in the camera line of sight", () => {
  const pose = cameraPose("chase", route.worldPos(1000), route.headingRad(1000));

  const inTheWay: Billboard = {
    routeDistanceM: 1000,
    side: 1,
    variant: 0,
    position: { ...pose.look, y: pose.look.y - 1 },
    yawRad: 0,
  };

  expect(segmentHitsBoard(inTheWay, pose.position, pose.look)).toBe(true);
});

it.each(["chase", "overview"] as const)(
  "%s camera never sits in or looks through a billboard on any test route",
  (mode) => {
    expect(allRoutes.flatMap((onRoute) => blockedViews(mode, onRoute))).toEqual([]);
  },
);

it("keeps every board base within 0.5 m above and 1 m below the road", () => {
  const offsets = boards.map((board) => board.position.y - route.worldPos(board.routeDistanceM).y);

  expect(Math.max(...offsets)).toBeLessThanOrEqual(0.5);
  expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-1);
});
