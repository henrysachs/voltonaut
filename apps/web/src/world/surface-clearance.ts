import { createCellGrid, itemsNear, type ItemBox } from "./cell-grid.js";
import { barycentric, doubleArea, planeHeight, type BandTriangle } from "./road-band.js";
import type { RoadClearance } from "./road-clearance.js";

interface PointXz {
  readonly x: number;
  readonly z: number;
}

type Edge = readonly [PointXz, PointXz];

function edges(triangle: BandTriangle): readonly Edge[] {
  const [a, b, c] = triangle;

  return [
    [a, b],
    [b, c],
    [c, a],
  ];
}

function inside(triangle: BandTriangle, point: PointXz): boolean {
  return barycentric(triangle, point).every((weight) => weight >= -1e-9);
}

/** Crossing point of two segments, or none when they are parallel or miss each other. */
function crossing(first: Edge, second: Edge): readonly PointXz[] {
  const [a, b] = first;
  const [c, d] = second;
  const denominator = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);

  if (Math.abs(denominator) < 1e-12) return [];

  const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / denominator;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? [{ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) }]
    : [];
}

/** Corners of the overlap of two triangles: both planes are linear there. */
function overlapCorners(band: BandTriangle, surface: BandTriangle): readonly PointXz[] {
  return [
    ...surface.filter((corner) => inside(band, corner)),
    ...band.filter((corner) => inside(surface, corner)),
    ...edges(band).flatMap((edge) => edges(surface).flatMap((other) => crossing(edge, other))),
  ];
}

function boxOf(triangle: BandTriangle): ItemBox {
  const xs = triangle.map((corner) => corner.x);
  const zs = triangle.map((corner) => corner.z);

  return {
    minX: Math.min(...xs),
    minZ: Math.min(...zs),
    maxX: Math.max(...xs),
    maxZ: Math.max(...zs),
  };
}

/**
 * Exact clearance of road band triangles over another drawn ground surface, such as the alpine
 * apron (spec E10-12 AK4): the gap is linear on every overlap, so its corners decide.
 */
export function surfaceClearance(
  band: readonly BandTriangle[],
  surface: readonly BandTriangle[],
): RoadClearance {
  const solid = surface.filter((triangle) => Math.abs(doubleArea(triangle)) >= 1e-9);

  const grid = createCellGrid(
    solid.map((triangle) => boxOf(triangle)),
    8,
  );

  let worst: RoadClearance = { minClearanceM: Number.POSITIVE_INFINITY, x: 0, z: 0 };

  for (const triangle of band.filter((candidate) => Math.abs(doubleArea(candidate)) >= 1e-9)) {
    const box = boxOf(triangle);
    const centerX = (box.minX + box.maxX) / 2;
    const centerZ = (box.minZ + box.maxZ) / 2;
    const reachM = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2;

    for (const item of itemsNear(grid, centerX, centerZ, reachM)) {
      const other = solid[item];

      for (const point of other === undefined ? [] : overlapCorners(triangle, other)) {
        const clearanceM = planeHeight(triangle, point) - planeHeight(other ?? triangle, point);

        if (clearanceM < worst.minClearanceM) worst = { minClearanceM: clearanceM, ...point };
      }
    }
  }

  return worst;
}
