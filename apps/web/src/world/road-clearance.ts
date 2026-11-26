import type { EngineRoute } from "@voltonaut/engine";

import { FINE_SPACING_M, heightAt, type Heightfield } from "./heightfield.js";
import { barycentric, bandTriangles, doubleArea, type BandTriangle } from "./road-band.js";

/** Smallest vertical gap between the road profile band and the drawn terrain, and where. */
export interface RoadClearance {
  readonly minClearanceM: number;
  readonly x: number;
  readonly z: number;
}

interface PointXz {
  readonly x: number;
  readonly z: number;
}

/** Grid lines x = k·s, z = k·s and the cell diagonals x − z = k·s crossed by an edge. */
function edgeCrossings(a: PointXz, b: PointXz): readonly PointXz[] {
  const crossings: PointXz[] = [];

  for (const value of [(p: PointXz) => p.x, (p: PointXz) => p.z, (p: PointXz) => p.x - p.z]) {
    const from = value(a);
    const to = value(b);

    for (
      let line = Math.ceil(Math.min(from, to) / FINE_SPACING_M);
      line <= Math.floor(Math.max(from, to) / FINE_SPACING_M);
      line += 1
    ) {
      const t = to === from ? 0 : (line * FINE_SPACING_M - from) / (to - from);

      crossings.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
    }
  }

  return crossings;
}

/** Raster vertices inside the triangle (on the fine lattice, which contains the coarse one). */
function gridVertices(triangle: BandTriangle): readonly PointXz[] {
  const xs = triangle.map((point) => point.x);
  const zs = triangle.map((point) => point.z);
  const inside: PointXz[] = [];

  for (
    let i = Math.ceil(Math.min(...xs) / FINE_SPACING_M);
    i * FINE_SPACING_M <= Math.max(...xs);
    i += 1
  ) {
    for (
      let j = Math.ceil(Math.min(...zs) / FINE_SPACING_M);
      j * FINE_SPACING_M <= Math.max(...zs);
      j += 1
    ) {
      const point = { x: i * FINE_SPACING_M, z: j * FINE_SPACING_M };

      if (barycentric(triangle, point).every((weight) => weight >= -1e-9)) inside.push(point);
    }
  }

  return inside;
}

/**
 * Every corner of the overlay of one band triangle with the terrain triangulation. Both
 * surfaces are linear inside each overlay cell, so their gap is extreme at these points.
 */
function overlayCorners(triangle: BandTriangle): readonly PointXz[] {
  const [a, b, c] = triangle;

  return [
    a,
    b,
    c,
    ...edgeCrossings(a, b),
    ...edgeCrossings(b, c),
    ...edgeCrossings(c, a),
    ...gridVertices(triangle),
  ];
}

/**
 * Exact clearance of a route's drawn road band over the terrain mesh (spec E10-12 AK4).
 * Degenerate band triangles carry no area and are skipped.
 */
export function roadClearance(field: Heightfield, route: EngineRoute): RoadClearance {
  let worst: RoadClearance = { minClearanceM: Number.POSITIVE_INFINITY, x: 0, z: 0 };

  for (const triangle of bandTriangles(route)) {
    const [a, b, c] = triangle;

    for (const point of Math.abs(doubleArea(triangle)) < 1e-9 ? [] : overlayCorners(triangle)) {
      const [u, v, w] = barycentric(triangle, point);
      const clearanceM = u * a.y + v * b.y + w * c.y - heightAt(field, point.x, point.z);

      if (clearanceM < worst.minClearanceM)
        worst = { minClearanceM: clearanceM, x: point.x, z: point.z };
    }
  }

  return worst;
}
