import { createRoute, KOM_CLIMB, TEST_LOOP, type EngineRoute } from "@voltonaut/engine";
import { describe, expect, it } from "vitest";

import { heightAt, type Heightfield } from "./heightfield.js";
import { offsetPosition, planLake } from "./lake-plan.js";
import { roadClearance } from "./road-clearance.js";
import {
  CAP_FLAT_M,
  corridorCandidates,
  corridorHeight,
  createCorridorIndex,
  EMBANKMENT_FLAT_M,
  ROAD_SINK_M,
  roadLine,
} from "./road-corridor.js";
import { hairpinRoad, polylineRoad } from "./road-test-routes.js";
import { planTerrain } from "./terrain-plan.js";

interface RasterPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function rasterPoints(field: Heightfield): readonly RasterPoint[] {
  return field.tiles.flatMap((tile) =>
    tile.heightsM.map((y, index) => ({
      x: tile.originX + (index % (tile.cells + 1)) * tile.spacingM,
      z: tile.originZ + Math.floor(index / (tile.cells + 1)) * tile.spacingM,
      y,
    })),
  );
}

function within(points: readonly RasterPoint[], box: Box): readonly RasterPoint[] {
  return points.filter(
    (p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ,
  );
}

/** Terrain of a world made of the given roads; the lake sits beside the first road. */
function terrainOf(roads: readonly EngineRoute[]): Heightfield {
  const [first] = roads;

  if (first === undefined) throw new Error("a world needs a road");

  return planTerrain(roads, [planLake(first)], 42).field;
}

/** Flat test road between two points. */
function flatRoad(
  id: string,
  from: readonly [number, number],
  to: readonly [number, number],
  heightM: number,
): EngineRoute {
  const centerline = [
    { x: from[0], z: from[1] },
    { x: to[0], z: to[1] },
  ];

  return polylineRoad(id, centerline, heightM, 0);
}

/** Largest absolute difference between two rasters of the same layout. */
function largestDifference(a: Heightfield, b: Heightfield): number {
  return Math.max(
    ...a.tiles.flatMap((tile, index) =>
      tile.heightsM.map((y, k) => Math.abs(y - (b.tiles[index]?.heightsM[k] ?? Number.NaN))),
    ),
  );
}

/** Raster heights 70 m left of the test loop, every 50 m, against the road height there. */
function reliefBesideLoop(): readonly number[] {
  const loop = createRoute(TEST_LOOP);
  const field = terrainOf([loop]);

  return Array.from({ length: 200 }, (_, index) => {
    const ground = offsetPosition(loop, index * 50, -70);

    return Math.abs(heightAt(field, ground.x, ground.z) - ground.y);
  });
}

function hairpinCandidates(): ReturnType<typeof corridorCandidates> {
  return corridorCandidates(createCorridorIndex([roadLine(hairpinRoad(12, 6))]), 100, 12);
}

const climb = createRoute(KOM_CLIMB);
const climbPoints = rasterPoints(terrainOf([climb]));

// Road A runs flat at 100 m along +x; B parallels it 14 m away, 6 m higher; C crosses A at 110 m.
const roadA = flatRoad("a", [0, 0], [400, 0], 100);
const roadB = flatRoad("b", [0, 14], [400, 14], 106);
const roadC = flatRoad("c", [200, -200], [200, 200], 110);
const parallel = terrainOf([roadA, roadB]);
const crossing = terrainOf([roadA, roadC]);

describe("corridor flattening (AK2)", () => {
  it("lays every raster point within 4 m of a constant climb exactly 6 cm under its foot point", () => {
    const near = within(climbPoints, { minX: 0, maxX: 2500, minZ: -4, maxZ: EMBANKMENT_FLAT_M });
    const offsets = near.map((p) => Math.abs(p.y - (climb.worldPos(p.x).y - ROAD_SINK_M)));

    expect(near.length).toBeGreaterThan(300);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(1e-9);
  });

  it("keeps every raster point within 17 m at or below the corridor floor", () => {
    const near = within(climbPoints, { minX: 0, maxX: 2500, minZ: -CAP_FLAT_M, maxZ: CAP_FLAT_M });
    const excess = near.map((p) => p.y - (climb.worldPos(p.x).y - ROAD_SINK_M));

    expect(near.length).toBeGreaterThan(1000);
    expect(Math.max(...excess)).toBeLessThanOrEqual(1e-9);
  });

  it("leaves rolling natural relief beside the test loop", () => {
    expect(Math.max(...reliefBesideLoop())).toBeGreaterThan(8);
  });

  it("floors each branch at the road height of its foot point", () => {
    const dip = roadLine(
      polylineRoad(
        "dip",
        [
          { x: 0, z: 0 },
          { x: 100, z: 0 },
        ],
        100,
        -8,
      ),
    );

    expect(corridorCandidates(createCorridorIndex([dip]), 50, 3)).toEqual([
      { distanceM: 3, floorM: 96 - ROAD_SINK_M },
    ]);
  });

  it("ignores roads beyond the corridor range", () => {
    expect(corridorHeight(500, [])).toBe(500);
    expect(corridorCandidates(createCorridorIndex([roadLine(roadA)]), 200, 60)).toEqual([]);
  });
});

describe("lower road wins (AK3)", () => {
  it("flattens the overlap of two parallel corridors onto the lower road", () => {
    const points = rasterPoints(parallel);
    const overlap = within(points, { minX: 40, maxX: 360, minZ: -4, maxZ: 18 });
    const onA = within(points, { minX: 40, maxX: 360, minZ: -4, maxZ: 4 });

    expect(onA.length).toBeGreaterThan(50);
    expect(Math.max(...overlap.map((p) => p.y))).toBeLessThanOrEqual(100 - ROAD_SINK_M + 1e-9);
    expect(Math.max(...onA.map((p) => Math.abs(p.y - (100 - ROAD_SINK_M))))).toBeLessThanOrEqual(
      1e-9,
    );
  });

  it("keeps both roads clear of the terrain where corridors overlap or cross", () => {
    expect(roadClearance(parallel, roadA).minClearanceM).toBeGreaterThanOrEqual(0.05);
    // B floats over terrain held down by A: far more than the 6 cm B would keep on its own.
    expect(roadClearance(parallel, roadB).minClearanceM).toBeGreaterThan(4);
    expect(roadClearance(crossing, roadA).minClearanceM).toBeGreaterThanOrEqual(0.05);
    expect(roadClearance(crossing, roadC).minClearanceM).toBeGreaterThanOrEqual(0.05);
    expect(heightAt(crossing, 200, 0)).toBeCloseTo(100 - ROAD_SINK_M, 9);
    expect(heightAt(crossing, 200, 120)).toBeCloseTo(110 - ROAD_SINK_M, 9);
  });

  it("lets the lower branch of a hairpin win", () => {
    const candidates = hairpinCandidates();

    expect(candidates).toHaveLength(2);
    expect(corridorHeight(200, candidates)).toBeLessThanOrEqual(
      Math.min(...candidates.map((candidate) => candidate.floorM)),
    );
  });

  it("does not depend on the order of the roads", () => {
    const reversed = planTerrain([roadB, roadA], [planLake(roadA)], 42).field;

    expect(largestDifference(parallel, reversed)).toBeLessThanOrEqual(1e-9);
  });
});
