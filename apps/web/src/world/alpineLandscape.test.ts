import { ALPINE_PASS, createRoute } from "@voltonaut/engine";
import { expect, it } from "vitest";

import { createCellGrid, itemsNear } from "./cell-grid.js";
import { heightAt, type Heightfield } from "./heightfield.js";
import { offsetPosition } from "./lake-plan.js";
import { createLandscapePlan, terrainPosition } from "./landscape-plan.js";
import { barycentric, planeHeight, ribbonTriangles, type BandTriangle } from "./road-band.js";

interface ShoulderGround {
  readonly label: string;
  readonly roadYM: number;
  readonly groundYM: number;
  readonly normalY: number;
}

const route = createRoute(ALPINE_PASS);
const plan = createLandscapePlan(route, [route], 42, false);
const apron = ribbonTriangles(plan.apron);

const apronGrid = createCellGrid(
  apron.map((triangle) => ({
    minX: Math.min(...triangle.map((corner) => corner.x)),
    minZ: Math.min(...triangle.map((corner) => corner.z)),
    maxX: Math.max(...triangle.map((corner) => corner.x)),
    maxZ: Math.max(...triangle.map((corner) => corner.z)),
  })),
  8,
);

interface Ground {
  readonly yM: number;
  readonly normalY: number;
}

/** Upward component of a triangle's unit normal. */
function planeNormalY(triangle: BandTriangle): number {
  const [a, b, c] = triangle;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  return Math.abs(ny) / Math.hypot(nx, ny, nz);
}

/** The highest drawn ground at a point: raster mesh or apron ribbon, as a downward ray hits it. */
function groundAt(x: number, z: number): Ground {
  const covering = itemsNear(apronGrid, x, z, 0).flatMap((item): readonly Ground[] => {
    const triangle = apron[item];

    return triangle !== undefined && barycentric(triangle, { x, z }).every((w) => w >= -1e-9)
      ? [{ yM: planeHeight(triangle, { x, z }), normalY: planeNormalY(triangle) }]
      : [];
  });

  const raster: Ground = { yM: heightAt(plan.terrain, x, z), normalY: normalY(plan.terrain, x, z) };

  const grounds: readonly Ground[] = [raster, ...covering];

  return grounds.reduce((top: Ground, next: Ground) => (next.yM > top.yM ? next : top));
}

/** Upward component of the drawn terrain's unit normal, from the mesh height around a point. */
function normalY(field: Heightfield, x: number, z: number): number {
  const stepM = 1e-3;
  const dx = (heightAt(field, x + stepM, z) - heightAt(field, x - stepM, z)) / (2 * stepM);
  const dz = (heightAt(field, x, z + stepM) - heightAt(field, x, z - stepM)) / (2 * stepM);

  return 1 / Math.hypot(dx, 1, dz);
}

/** Ground under both asphalt edges (±3.5 m) every 10 m in [startM, endM], as #169 sampled it. */
function shoulderGround(startM: number, endM: number): readonly ShoulderGround[] {
  const rowCount = Math.ceil(route.lengthM / 10);
  const samples: ShoulderGround[] = [];

  for (
    let sample = Math.floor(startM / 10);
    sample <= Math.ceil(Math.min(endM, route.lengthM) / 10);
    sample += 1
  ) {
    const distanceM = sample === rowCount ? route.lengthM - 0.01 : sample * 10 + 0.01;

    for (const lateralM of [-3.5, 3.5]) {
      const position = offsetPosition(route, distanceM, lateralM);
      const ground = groundAt(position.x, position.z);

      samples.push({
        label: `d=${distanceM}, lateral=${lateralM}`,
        roadYM: position.y,
        groundYM: ground.yM,
        normalY: ground.normalY,
      });
    }
  }

  return samples;
}

it("keeps alpine terrain offsets open after the rounded switchback", () => {
  const cornerCenter = route.worldPos(1500);
  const corner = terrainPosition(plan, 1500, 100);
  const straightCenter = route.worldPos(100);
  const straight = terrainPosition(plan, 100, 100);

  expect(Math.hypot(corner.x - cornerCenter.x, corner.z - cornerCenter.z)).toBeGreaterThan(90);
  expect(Math.hypot(straight.x - straightCenter.x, straight.z - straightCenter.z)).toBeGreaterThan(
    90,
  );
});

const ALPINE_SHOULDER_RANGES = [
  [0, 4000],
  [4000, 8000],
  [8000, 12_000],
  [12_000, 16_000],
  [16_000, 20_000],
  [20_000, 24_000],
  [24_000, 28_000],
  [28_000, 30_000],
] as const;

it.each(ALPINE_SHOULDER_RANGES)(
  "keeps both alpine road shoulders on ground just below the real road from %i to %i m",
  (startM, endM) => {
    const samples = shoulderGround(startM, endM);

    expect(samples.length).toBeGreaterThan(70);
    expect(samples.filter((s) => s.groundYM >= s.roadYM).map((s) => s.label)).toEqual([]);
    expect(samples.filter((s) => s.groundYM <= s.roadYM - 0.6).map((s) => s.label)).toEqual([]);
    expect(samples.filter((s) => s.normalY <= 0.9).map((s) => s.label)).toEqual([]);
  },
);
