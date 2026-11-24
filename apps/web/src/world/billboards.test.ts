import { createRoute, KOM_CLIMB, TEST_LOOP, type EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import {
  MOTIF_BACKGROUND,
  MOTIF_BOLT,
  MOTIF_BORDER,
  MOTIF_HEIGHT_PX,
  MOTIF_WIDTH_PX,
  paintPlaceholderMotif,
} from "./billboard-motif.js";
import {
  BILLBOARD_LATERAL_M,
  BILLBOARD_SPACING_M,
  BILLBOARD_WIDTH_M,
  planBillboards,
  type Billboard,
} from "./billboard-plan.js";
import { createBillboards } from "./billboards.js";
import { createLandscapeSystem } from "./landscape.js";
import { createLandscapePlan, lakeRadius, offsetPosition } from "./landscape-plan.js";
import { createScheduler } from "./scheduler.js";

interface PointXz {
  readonly x: number;
  readonly z: number;
}

const loop = createRoute(TEST_LOOP);
const loopPlan = createLandscapePlan(loop);
const loopBoards = planBillboards(loopPlan);

/** Board edges in world xz: the board's width axis is local +x rotated by yaw. */
function boardEdges(board: Billboard): readonly PointXz[] {
  const half = BILLBOARD_WIDTH_M / 2;

  return [-half, half].map((offsetM) => ({
    x: board.position.x + Math.cos(board.yawRad) * offsetM,
    z: board.position.z - Math.sin(board.yawRad) * offsetM,
  }));
}

function distanceToRoadM(route: EngineRoute, point: PointXz): number {
  const samples = Array.from({ length: Math.ceil(route.lengthM / 2) + 1 }, (_, index) =>
    route.worldPos(Math.min(route.lengthM, index * 2)),
  );

  return Math.min(...samples.map((sample) => Math.hypot(sample.x - point.x, sample.z - point.z)));
}

/** Focal spots (start/finish, around segments) where a side has neither a board nor the lake. */
function missingFocalSides(): readonly string[] {
  const focalM = [
    20,
    ...loop.segments.flatMap((segment) => [segment.startM - 25, segment.endM + 25]),
  ];

  return focalM.flatMap((distanceM) =>
    ([-1, 1] as const).flatMap((side) => {
      const placed = loopBoards.some(
        (board) => board.side === side && Math.abs(board.routeDistanceM - distanceM) <= 25,
      );

      const lakeSpot = offsetPosition(loop, distanceM, side * BILLBOARD_LATERAL_M);

      return placed || lakeRadius(loopPlan.lake, lakeSpot) < 1.25
        ? []
        : [`${side} at ${distanceM} m`];
    }),
  );
}

function longestGapM(): number {
  const distances = loopBoards.map((board) => board.routeDistanceM);
  const wrapGapM = loop.lengthM - Math.max(...distances) + Math.min(...distances);

  return Math.max(
    wrapGapM,
    ...distances.slice(1).map((distanceM, index) => distanceM - (distances[index] ?? distanceM)),
  );
}

function instanceCounts(): readonly number[] {
  const root = createBillboards(loopBoards);

  return [
    root.children.length,
    ...["billboard-structure", "billboard-faces"].map((name) => {
      const mesh = root.getObjectByName(name);

      return mesh instanceof THREE.InstancedMesh ? mesh.count : -1;
    }),
  ];
}

function faceTextureSize(): readonly number[] {
  const faces = createBillboards(loopBoards).getObjectByName("billboard-faces");

  if (
    faces instanceof THREE.Mesh &&
    faces.material instanceof THREE.MeshStandardMaterial &&
    faces.material.map instanceof THREE.DataTexture
  ) {
    const image: { readonly width: number; readonly height: number } = faces.material.map.image;

    return [image.width, image.height];
  }

  throw new Error("billboard faces need a motif texture");
}

function isReleasedWithMaterial(): boolean {
  const faces = createBillboards(loopBoards).getObjectByName("billboard-faces");
  let released = false;

  if (faces instanceof THREE.Mesh && faces.material instanceof THREE.MeshStandardMaterial) {
    faces.material.map?.addEventListener("dispose", () => {
      released = true;
    });
    faces.material.dispose();
  }

  return released;
}

function motifPixel(xPx: number, yPx: number): readonly number[] {
  const offset = (yPx * MOTIF_WIDTH_PX + xPx) * 4;

  return [...paintPlaceholderMotif(MOTIF_WIDTH_PX, MOTIF_HEIGHT_PX).subarray(offset, offset + 3)];
}

function minWaymarkClearanceM(): number {
  const waymarks = Array.from({ length: Math.ceil(loop.lengthM / 1000) }, (_, km) =>
    offsetPosition(loop, km * 1000 + 30, -6.2),
  );

  return Math.min(
    ...loopBoards.flatMap((board) =>
      [board.position, ...boardEdges(board)].flatMap((point) =>
        waymarks.map((waymark) => Math.hypot(point.x - waymark.x, point.z - waymark.z)),
      ),
    ),
  );
}

it("places billboards deterministically for the same route", () => {
  expect(planBillboards(createLandscapePlan(createRoute(TEST_LOOP)))).toEqual(loopBoards);
});

it("places a pair at start/finish and around every segment unless the lake takes a side", () => {
  expect(missingFocalSides()).toEqual([]);
});

it("moves a left-side board away from a kilometre waymark against travel direction", () => {
  expect(
    loopBoards.filter((board) => board.routeDistanceM < 60).map((board) => board.routeDistanceM),
  ).toEqual([18, 20]);
});

it("adds a finish pair on point-to-point routes", () => {
  const climb = createRoute(KOM_CLIMB);

  const finish = planBillboards(createLandscapePlan(climb)).filter(
    (board) => board.routeDistanceM >= climb.lengthM - 40,
  );

  expect(climb.loop).toBe(false);
  expect(new Set(finish.map((board) => board.side))).toEqual(new Set([-1, 1]));
});

it("leaves no stretch longer than the spacing without a billboard, on both sides", () => {
  expect(longestGapM()).toBeLessThanOrEqual(BILLBOARD_SPACING_M + 60);
  expect(new Set(loopBoards.map((board) => board.side))).toEqual(new Set([-1, 1]));
});

it("keeps every board edge off the road and shoulder", () => {
  const edges = loopBoards.flatMap((board) => boardEdges(board));

  expect(Math.min(...edges.map((edge) => distanceToRoadM(loop, edge)))).toBeGreaterThan(6);
});

it("keeps clear of the kilometre waymarks and the lake", () => {
  expect(minWaymarkClearanceM()).toBeGreaterThan(3);
  expect(
    Math.min(...loopBoards.map((board) => lakeRadius(loopPlan.lake, board.position))),
  ).toBeGreaterThanOrEqual(1.2);
});

it("stands at the planned lateral offset and faces riders coming along the route", () => {
  const offsetsM = loopBoards.map((board) => {
    const road = loop.worldPos(board.routeDistanceM);

    return Math.hypot(board.position.x - road.x, board.position.z - road.z);
  });

  // Dot product of the face normal with the travel direction: negative = towards approaching riders.
  const facing = loopBoards.map((board) => {
    const heading = loop.headingRad(board.routeDistanceM);

    return Math.sin(board.yawRad) * Math.cos(heading) + Math.cos(board.yawRad) * Math.sin(heading);
  });

  expect(Math.min(...offsetsM)).toBeCloseTo(BILLBOARD_LATERAL_M);
  expect(Math.max(...offsetsM)).toBeCloseTo(BILLBOARD_LATERAL_M);
  expect(Math.max(...facing)).toBeLessThan(-0.8);
});

it("draws all billboards with two instanced meshes", () => {
  expect(instanceCounts()).toEqual([2, loopBoards.length * 3, loopBoards.length]);
});

it("keeps the motif texture within budget and releases it with its material", () => {
  expect(faceTextureSize()).toEqual([MOTIF_WIDTH_PX, MOTIF_HEIGHT_PX]);
  expect(Math.max(MOTIF_WIDTH_PX, MOTIF_HEIGHT_PX)).toBeLessThanOrEqual(2048);
  expect(isReleasedWithMaterial()).toBe(true);
});

it("paints a bordered placeholder motif with a centred bolt", () => {
  expect(paintPlaceholderMotif(8, 4)).toEqual(paintPlaceholderMotif(8, 4));
  expect(motifPixel(0, 0)).toEqual(MOTIF_BORDER);
  expect(motifPixel(MOTIF_WIDTH_PX / 2, MOTIF_HEIGHT_PX / 2)).toEqual(MOTIF_BOLT);
  expect(motifPixel(60, MOTIF_HEIGHT_PX / 2)).toEqual(MOTIF_BACKGROUND);
});

it("is part of the landscape scene", () => {
  const scene = new THREE.Scene();

  createScheduler([createLandscapeSystem()], { scene, route: loop });
  expect(scene.getObjectByName("billboards")).toBeInstanceOf(THREE.Group);
});
