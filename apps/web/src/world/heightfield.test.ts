import { createRoute, TEST_LOOP } from "@voltonaut/engine";
import { describe, expect, it } from "vitest";

import {
  COARSE_SPACING_M,
  createHeightfield,
  FINE_SPACING_M,
  heightAt,
  TILE_SIZE_M,
  tileAt,
  tileLayout,
  type Heightfield,
  type HeightSource,
  type TerrainTile,
} from "./heightfield.js";
import { planLake } from "./lake-plan.js";
import { roadCenterSamples } from "./road-plan.js";
import { FIELD_MARGIN_M, FINE_REACH_M, planTerrain } from "./terrain-plan.js";

const wavy: HeightSource = {
  isFine: (column, row) => (column + row) % 2 === 0,
  heightAt: (x, z) => 100 + 7 * Math.sin(x / 41) + 5 * Math.cos(z / 23 + x / 97),
};

const layout = tileLayout({ minX: -300, minZ: -100, maxX: 300, maxZ: 500 }, 0);
const checkerboard = createHeightfield(layout, wavy);
const loop = createRoute(TEST_LOOP);
const loopTerrain = planTerrain([loop], [planLake(loop)], 42);

function tile(field: Heightfield, column: number, row: number): TerrainTile {
  const found = field.tiles[row * field.columns + column];

  if (found === undefined) throw new Error(`tile ${column}:${row} missing`);

  return found;
}

function vertex(found: TerrainTile, i: number, j: number): number {
  return found.heightsM[j * (found.cells + 1) + i] ?? Number.NaN;
}

/** Tiles whose rectangle, grown by half the fine reach, contains a drawn road point. */
function tilesNearRoad(): readonly TerrainTile[] {
  const samples = roadCenterSamples(loop);
  const growM = FINE_REACH_M / 2;

  return loopTerrain.field.tiles.filter((t) =>
    samples.some(
      (p) =>
        p.x >= t.originX - growM &&
        p.x <= t.originX + TILE_SIZE_M + growM &&
        p.z >= t.originZ - growM &&
        p.z <= t.originZ + TILE_SIZE_M + growM,
    ),
  );
}

/** East-west neighbours of the same raster in the test loop field. */
function sameRasterPairs(): readonly (readonly [TerrainTile, TerrainTile])[] {
  const field = loopTerrain.field;

  return field.tiles.flatMap((left) => {
    const right = field.tiles[left.row * field.columns + left.column + 1];

    const same =
      right !== undefined && left.column + 1 < field.columns && right.spacingM === left.spacingM;

    return same ? [[left, right] as const] : [];
  });
}

/** Height differences 1e-6 m either side of every inner tile border, every 1.7 m. */
function borderJumps(field: Heightfield): readonly number[] {
  const jumps: number[] = [];
  const endX = field.originX + field.columns * TILE_SIZE_M;
  const endZ = field.originZ + field.rows * TILE_SIZE_M;

  for (let column = 1; column < field.columns; column += 1) {
    const x = field.originX + column * TILE_SIZE_M;

    for (let z = field.originZ; z < endZ; z += 1.7) {
      jumps.push(Math.abs(heightAt(field, x - 1e-6, z) - heightAt(field, x + 1e-6, z)));
    }
  }

  for (let row = 1; row < field.rows; row += 1) {
    const z = field.originZ + row * TILE_SIZE_M;

    for (let x = field.originX; x < endX; x += 1.7) {
      jumps.push(Math.abs(heightAt(field, x, z - 1e-6) - heightAt(field, x, z + 1e-6)));
    }
  }

  return jumps;
}

/** A single fine tile whose point b = (8, 0) is raised by 1 m. */
const raisedCorner = createHeightfield(tileLayout({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, 0), {
  isFine: () => true,
  heightAt: (x, z) => Number(x === 8 && z === 0),
});

describe("tile layout (AK1)", () => {
  it("aligns 256 m tiles to multiples of 256 m around the bounds plus margin", () => {
    expect(layout).toEqual({ originX: -512, originZ: -256, columns: 4, rows: 3 });
    expect(tileLayout({ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, 384)).toEqual({
      originX: -512,
      originZ: -512,
      columns: 4,
      rows: 4,
    });
  });

  it("covers every test loop road point with the margin and samples 33² or 9² points", () => {
    const field = loopTerrain.field;
    const endX = field.originX + field.columns * TILE_SIZE_M;
    const endZ = field.originZ + field.rows * TILE_SIZE_M;
    const samples = roadCenterSamples(loop);

    expect(Math.abs(field.originX % TILE_SIZE_M)).toBe(0);
    expect(Math.abs(field.originZ % TILE_SIZE_M)).toBe(0);
    expect(Math.min(...samples.map((p) => p.x)) - field.originX).toBeGreaterThanOrEqual(
      FIELD_MARGIN_M,
    );
    expect(endX - Math.max(...samples.map((p) => p.x))).toBeGreaterThanOrEqual(FIELD_MARGIN_M);
    expect(Math.min(...samples.map((p) => p.z)) - field.originZ).toBeGreaterThanOrEqual(
      FIELD_MARGIN_M,
    );
    expect(endZ - Math.max(...samples.map((p) => p.z))).toBeGreaterThanOrEqual(FIELD_MARGIN_M);
    expect(field.tiles).toHaveLength(field.columns * field.rows);
    expect(new Set(field.tiles.map((t) => `${t.spacingM}:${t.heightsM.length}`))).toEqual(
      new Set([`${FINE_SPACING_M}:${33 * 33}`, `${COARSE_SPACING_M}:${9 * 9}`]),
    );
  });

  it("gives every tile near the road the fine raster and the empty loop centre the coarse one", () => {
    const nearRoad = tilesNearRoad();

    expect(nearRoad.length).toBeGreaterThan(40);
    expect(new Set(nearRoad.map((t) => t.spacingM))).toEqual(new Set([FINE_SPACING_M]));
    expect(tileAt(loopTerrain.field, 0, 0).spacingM).toBe(COARSE_SPACING_M);
  });
});

describe("tile borders (AK5)", () => {
  it("lays fine border points onto the straight edge of the coarse neighbour", () => {
    const fine = tile(checkerboard, 1, 1);
    const west = tile(checkerboard, 0, 1);

    expect(fine.spacingM).toBe(FINE_SPACING_M);
    expect(west.spacingM).toBe(COARSE_SPACING_M);

    for (let k = 0; k <= fine.cells; k += 1) {
      const low = Math.floor(k / 4);
      const high = Math.min(west.cells, low + 1);
      const fraction = k / 4 - low;

      const edgeM =
        vertex(west, west.cells, low) * (1 - fraction) + vertex(west, west.cells, high) * fraction;

      expect(Math.abs(vertex(fine, 0, k) - edgeM)).toBeLessThanOrEqual(1e-9);
    }
  });

  it("keeps the raster height continuous across every tile border", () => {
    const jumps = borderJumps(checkerboard);

    expect(jumps.length).toBeGreaterThan(1000);
    expect(Math.max(...jumps)).toBeLessThanOrEqual(1e-4);
  });

  it("shares bit-identical border points between tiles of the same raster", () => {
    const pairs = sameRasterPairs();

    expect(pairs.length).toBeGreaterThan(100);

    for (const [left, right] of pairs) {
      const leftEdge = Array.from({ length: left.cells + 1 }, (_, k) =>
        vertex(left, left.cells, k),
      );

      const rightEdge = Array.from({ length: right.cells + 1 }, (_, k) => vertex(right, 0, k));

      expect(rightEdge).toEqual(leftEdge);
    }
  });
});

describe("mesh height", () => {
  it("reproduces a plane exactly on fine and coarse tiles and at the field border", () => {
    const plane = createHeightfield(layout, {
      isFine: wavy.isFine,
      heightAt: (x, z) => 3 + 0.02 * x - 0.05 * z,
    });

    for (const [x, z] of [
      [-511.9, -255],
      [-100.3, 17.25],
      [0, 0],
      [255.99, 511.99],
      [77.7, 300.1],
    ] as const) {
      expect(heightAt(plane, x, z)).toBeCloseTo(3 + 0.02 * x - 0.05 * z, 9);
    }
  });

  it("interpolates each cell on its (i, j)–(i + 1, j + 1) diagonal", () => {
    // Point b = (8, 0) rises; the triangle (a, d, b) carries it, (a, c, d) stays flat.
    expect(heightAt(raisedCorner, 6, 2)).toBeCloseTo(0.5, 12);
    expect(heightAt(raisedCorner, 2, 6)).toBe(0);
  });
});

describe("determinism (AK6)", () => {
  it("repeats the same raster for the same roads and seed and changes the relief with the seed", () => {
    const again = planTerrain([loop], [planLake(loop)], 42).field;
    const otherSeed = planTerrain([loop], [planLake(loop)], 43).field;

    expect(again).toEqual(loopTerrain.field);
    expect(otherSeed.tiles.map((t) => t.heightsM)).not.toEqual(
      loopTerrain.field.tiles.map((t) => t.heightsM),
    );
  });
});
