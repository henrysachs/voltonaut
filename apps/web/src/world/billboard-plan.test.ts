import { createRoute, FLAT_LOOP, KOM_CLIMB, TEST_LOOP, type EngineRoute } from "@voltonaut/engine";
import { expect, it } from "vitest";

import {
  BILLBOARD_LATERAL_M,
  BILLBOARD_VARIANTS,
  BILLBOARD_WIDTH_M,
  billboardSlotCount,
  planBillboards,
  type Billboard,
} from "./billboard-plan.js";
import { lakeRadius, offsetPosition } from "./lake-plan.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { planWaymarks } from "./waymark-plan.js";

interface PointXz {
  readonly x: number;
  readonly z: number;
}

const loop = createRoute(TEST_LOOP);
const loopPlan = createLandscapePlan(loop);
const loopResult = planBillboards(loopPlan);
const loopBoards = loopResult.billboards;

function resultFor(route: EngineRoute) {
  return planBillboards(createLandscapePlan(route));
}

/** Board edges in world xz: the board's width axis is local +x rotated by yaw. */
function boardEdges(board: Billboard): readonly PointXz[] {
  const half = BILLBOARD_WIDTH_M / 2;

  return [-half, half].map((offsetM) => ({
    x: board.position.x + Math.cos(board.yawRad) * offsetM,
    z: board.position.z - Math.sin(board.yawRad) * offsetM,
  }));
}

function distanceToRoadM(point: PointXz): number {
  const samples = Array.from({ length: Math.ceil(loop.lengthM / 2) + 1 }, (_, index) =>
    loop.worldPos(Math.min(loop.lengthM, index * 2)),
  );

  return Math.min(...samples.map((sample) => Math.hypot(sample.x - point.x, sample.z - point.z)));
}

/** Along-route gap between a board and the nearest waymark on the same (left) side. */
function nearestSameSideWaymarkM(): number {
  const lefts = loopBoards.filter((board) => board.side === -1);

  return Math.min(
    ...lefts.flatMap((board) =>
      planWaymarks(loop).map((waymark) => Math.abs(board.routeDistanceM - waymark.distanceM)),
    ),
  );
}

it("places billboards deterministically for the same route", () => {
  expect(resultFor(createRoute(TEST_LOOP))).toEqual(loopResult);
});

it("plans three slots per kilometre on every test route", () => {
  expect(billboardSlotCount(loop)).toBe(30);
  expect(billboardSlotCount(createRoute(FLAT_LOOP))).toBe(15);
  expect(billboardSlotCount(createRoute(KOM_CLIMB))).toBe(8);
});

it("accounts for every slot as placed or skipped", () => {
  for (const route of [loop, createRoute(FLAT_LOOP), createRoute(KOM_CLIMB)]) {
    const result = resultFor(route);

    expect(result.billboards.length + result.skipped.length).toBe(billboardSlotCount(route));
  }
});

it("skips a slot the lake blocks across the whole 40 m shift window", () => {
  const spot = offsetPosition(loop, 667, BILLBOARD_LATERAL_M);

  const flooded = planBillboards({
    ...loopPlan,
    lake: { ...loopPlan.lake, center: spot, alongRadiusM: 60, acrossRadiusM: 60 },
  });

  expect(flooded.skipped).toEqual([{ distanceM: 2000 / 3, side: 1, reason: "lake" }]);
  expect(flooded.billboards).toHaveLength(29);
});

it("shifts a left slot away from a kilometre waymark instead of dropping it", () => {
  expect(loopResult.skipped).toEqual([]);
  expect(loopBoards.map((board) => Math.round(board.routeDistanceM))).toContain(990);
});

it("pulls a slot onto start/finish and every segment start and end", () => {
  const priorityM = [20, 1975, 2525, 4975, 5625];

  expect(
    priorityM.map((distanceM) =>
      loopBoards.some((board) => Math.abs(board.routeDistanceM - distanceM) <= 40),
    ),
  ).toEqual([true, true, true, true, true]);
});

it("pulls a finish slot on point-to-point routes", () => {
  const climb = createRoute(KOM_CLIMB);

  expect(
    resultFor(climb).billboards.some((board) => board.routeDistanceM >= climb.lengthM - 60),
  ).toBe(true);
});

it("alternates sides and rotates the motif variants in route order", () => {
  expect(new Set(loopBoards.map((board) => board.side))).toEqual(new Set([-1, 1]));
  expect(loopBoards.map((board) => board.variant)).toEqual(
    loopBoards.map((_, index) => index % BILLBOARD_VARIANTS),
  );
});

it("keeps every board edge off the road and shoulder", () => {
  const edges = loopBoards.flatMap((board) => boardEdges(board));

  expect(Math.min(...edges.map((edge) => distanceToRoadM(edge)))).toBeGreaterThan(6);
});

it("keeps 40 m from the kilometre waymarks on their side and stays out of the lake", () => {
  expect(nearestSameSideWaymarkM()).toBeGreaterThanOrEqual(40);
  expect(
    Math.min(...loopBoards.map((board) => lakeRadius(loopPlan.lake, board.position))),
  ).toBeGreaterThanOrEqual(1.3);
});

it("stands at the planned lateral offset and faces riders coming along the route", () => {
  const offsetsM = loopBoards.map((board) => {
    const road = loop.worldPos(board.routeDistanceM);

    return Math.hypot(board.position.x - road.x, board.position.z - road.z);
  });

  // Face normal against the travel direction: negative = towards approaching riders.
  const facing = loopBoards.map((board) => {
    const heading = loop.headingRad(board.routeDistanceM);

    return Math.sin(board.yawRad) * Math.cos(heading) + Math.cos(board.yawRad) * Math.sin(heading);
  });

  expect(Math.min(...offsetsM)).toBeCloseTo(BILLBOARD_LATERAL_M);
  expect(Math.max(...offsetsM)).toBeCloseTo(BILLBOARD_LATERAL_M);
  expect(Math.max(...facing)).toBeLessThan(-0.8);
});
