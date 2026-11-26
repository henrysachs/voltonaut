import type { EngineRoute, WorldPos } from "@voltonaut/engine";

import { FINE_SPACING_M } from "./heightfield.js";
import { createCellGrid, itemsNear, type CellGrid } from "./cell-grid.js";
import { ROAD_LIFT_M, sampleRoad, SHOULDER_WIDTH_M, type RoadSample } from "./road-plan.js";

/** One triangle of the drawn shoulder band, at route profile height (without the lift). */
export type BandTriangle = readonly [WorldPos, WorldPos, WorldPos];

/**
 * A terrain triangle touching the band has every corner within one cell diagonal of the band
 * point it covers, so band planes this close bound the terrain corners (spec E10-12).
 */
export const BAND_REACH_M = FINE_SPACING_M * Math.SQRT2 + 0.01;

interface PointXz {
  readonly x: number;
  readonly z: number;
}

export interface BandIndex {
  readonly triangles: readonly BandTriangle[];
  readonly grid: CellGrid;
}

/** Two triangles per ribbon step, as road.ts indexes them: (Lₖ₋₁, Rₖ₋₁, Lₖ), (Lₖ, Rₖ₋₁, Rₖ). */
export function ribbonTriangles(samples: readonly RoadSample[]): readonly BandTriangle[] {
  return samples.slice(1).flatMap((sample, index): BandTriangle[] => {
    const previous = samples[index] ?? sample;

    return [
      [previous.left, previous.right, sample.left],
      [sample.left, previous.right, sample.right],
    ];
  });
}

/** The drawn shoulder band at route profile height (without the lift). */
export function bandTriangles(route: EngineRoute): readonly BandTriangle[] {
  return ribbonTriangles(
    sampleRoad(route, SHOULDER_WIDTH_M).map((sample): RoadSample => ({
      left: { ...sample.left, y: sample.left.y - ROAD_LIFT_M },
      right: { ...sample.right, y: sample.right.y - ROAD_LIFT_M },
    })),
  );
}

/** Signed area doubled; band triangles below 1e-9 m² carry no road surface. */
export function doubleArea(triangle: BandTriangle): number {
  const [a, b, c] = triangle;

  return (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
}

/** Barycentric weights; outside the triangle some are negative (plane extension). */
export function barycentric(
  triangle: BandTriangle,
  point: PointXz,
): readonly [number, number, number] {
  const [a, b, c] = triangle;
  const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  const u = ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) / determinant;
  const v = ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) / determinant;

  return [u, v, 1 - u - v];
}

export function planeHeight(triangle: BandTriangle, point: PointXz): number {
  const [u, v, w] = barycentric(triangle, point);
  const [a, b, c] = triangle;

  return u * a.y + v * b.y + w * c.y;
}

function segmentDistance(point: PointXz, a: PointXz, b: PointXz): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;

  const t =
    lengthSq === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));

  return Math.hypot(a.x + t * dx - point.x, a.z + t * dz - point.z);
}

function isInside(triangle: BandTriangle, point: PointXz): boolean {
  const [u, v, w] = barycentric(triangle, point);

  return u >= 0 && v >= 0 && w >= 0;
}

function triangleDistance(triangle: BandTriangle, point: PointXz): number {
  const [a, b, c] = triangle;

  if (isInside(triangle, point)) return 0;

  return Math.min(
    segmentDistance(point, a, b),
    segmentDistance(point, b, c),
    segmentDistance(point, c, a),
  );
}

/** Buckets every band triangle with area by its XZ box into 16 m cells. */
export function createBandIndex(routes: readonly EngineRoute[]): BandIndex {
  const triangles = routes
    .flatMap((route) => bandTriangles(route))
    .filter((triangle) => Math.abs(doubleArea(triangle)) >= 1e-9);

  const boxes = triangles.map((triangle) => {
    const xs = triangle.map((corner) => corner.x);
    const zs = triangle.map((corner) => corner.z);

    return {
      minX: Math.min(...xs),
      minZ: Math.min(...zs),
      maxX: Math.max(...xs),
      maxZ: Math.max(...zs),
    };
  });

  return { triangles, grid: createCellGrid(boxes, 16) };
}

/**
 * Lowest extended band plane among the band triangles within BAND_REACH_M, or Infinity.
 * Every terrain corner near a road stays on or below it, which proves the clearance.
 */
export function bandCeilingAt(index: BandIndex, x: number, z: number): number {
  const point = { x, z };
  let lowest = Number.POSITIVE_INFINITY;

  for (const item of itemsNear(index.grid, x, z, BAND_REACH_M)) {
    const triangle = index.triangles[item];

    if (triangle !== undefined && triangleDistance(triangle, point) <= BAND_REACH_M) {
      lowest = Math.min(lowest, planeHeight(triangle, point));
    }
  }

  return lowest;
}

/** Lowest band surface directly above or below a point, or Infinity off the band. */
export function bandSurfaceAt(index: BandIndex, x: number, z: number): number {
  const point = { x, z };
  let lowest = Number.POSITIVE_INFINITY;

  for (const item of itemsNear(index.grid, x, z, 0)) {
    const triangle = index.triangles[item];

    if (triangle !== undefined && barycentric(triangle, point).every((weight) => weight >= -1e-9)) {
      lowest = Math.min(lowest, planeHeight(triangle, point));
    }
  }

  return lowest;
}
