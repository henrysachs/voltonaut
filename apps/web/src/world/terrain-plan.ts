import type { EngineRoute } from "@voltonaut/engine";

import { createCellGrid, itemsNear, type ItemBox } from "./cell-grid.js";
import {
  createHeightfield,
  TILE_SIZE_M,
  tileLayout,
  type Heightfield,
  type HeightSource,
  type TileLayout,
} from "./heightfield.js";
import { lakeBounds, withLakeBasin, type Lake } from "./lake-plan.js";
import { baseHeightAt, createBaseLattice, reliefAt } from "./natural-terrain.js";
import { bandCeilingAt, createBandIndex } from "./road-band.js";
import {
  CORRIDOR_RANGE_M,
  corridorCandidates,
  corridorHeight,
  createCorridorIndex,
  ROAD_SINK_M,
  roadLine,
  type CorridorIndex,
  type RoadLine,
  type RoadPoint,
} from "./road-corridor.js";

/** The raster reaches this far beyond the outermost road (the old strip reached 360 m). */
export const FIELD_MARGIN_M = 384;

/** Tiles closer than this to a road get the fine 8 m raster. */
export const FINE_REACH_M = 64;

export interface TerrainPlan {
  readonly field: Heightfield;
  readonly corridor: CorridorIndex;
}

function chordBox(a: RoadPoint, b: RoadPoint, reachM: number): ItemBox {
  return {
    minX: Math.min(a.x, b.x) - reachM,
    minZ: Math.min(a.z, b.z) - reachM,
    maxX: Math.max(a.x, b.x) + reachM,
    maxZ: Math.max(a.z, b.z) + reachM,
  };
}

function chordBoxes(lines: readonly RoadLine[], reachM: number): readonly ItemBox[] {
  return lines.flatMap((line) =>
    line.points.slice(1).map((b, index) => chordBox(line.points[index] ?? b, b, reachM)),
  );
}

function enclosing(boxes: readonly ItemBox[]): ItemBox {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minZ: Math.min(...boxes.map((box) => box.minZ)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxZ: Math.max(...boxes.map((box) => box.maxZ)),
  };
}

/** Tiles within FINE_REACH_M of any road chord or touching the lake basin get 8 m spacing. */
function fineTileTest(
  layout: TileLayout,
  lines: readonly RoadLine[],
  lakes: readonly Lake[],
): HeightSource["isFine"] {
  const grid = createCellGrid(
    [...chordBoxes(lines, FINE_REACH_M), ...lakes.map((lake) => lakeBounds(lake))],
    TILE_SIZE_M,
  );

  const half = TILE_SIZE_M / 2;

  // A tile is fine when any box overlaps its square (half a tile around its centre).
  return (column, row) =>
    itemsNear(
      grid,
      layout.originX + column * TILE_SIZE_M + half,
      layout.originZ + row * TILE_SIZE_M + half,
      half,
    ).length > 0;
}

/** Side of the cells that remember whether any road comes within corridor range. */
const QUIET_CELL_M = 32;

/**
 * Whether a road may reach a point: false only when no chord comes within CORRIDOR_RANGE_M of
 * any point of its 32 m cell. Corridor and band queries then return nothing, so skipping them
 * changes no height; it only saves the searches for the open land (spec E10-12).
 */
function roadReachTest(corridor: CorridorIndex): (x: number, z: number) => boolean {
  const cells = new Map<number, boolean>();
  const halfDiagonalM = (QUIET_CELL_M * Math.SQRT2) / 2;

  return (x, z) => {
    const column = Math.floor(x / QUIET_CELL_M);
    const row = Math.floor(z / QUIET_CELL_M);
    // Unique while |row| < 2¹⁶ cells (2 097 km), far beyond any world.
    const key = column * 131_072 + row;
    const known = cells.get(key);

    if (known !== undefined) return known;

    const centerX = (column + 0.5) * QUIET_CELL_M;
    const centerZ = (row + 0.5) * QUIET_CELL_M;
    const reach = itemsNear(corridor.grid, centerX, centerZ, CORRIDOR_RANGE_M + halfDiagonalM);

    cells.set(key, reach.length > 0);

    return reach.length > 0;
  };
}

/**
 * World terrain (ADR-033 §5): natural ground from the road heights, relief and lake basin,
 * flattened by every road corridor with the lower road winning, kept under every nearby
 * drawn road plane, sampled into 256 m tiles.
 */
export function planTerrain(
  roads: readonly EngineRoute[],
  lakes: readonly Lake[],
  seed: number,
): TerrainPlan {
  const lines = roads.map((road) => roadLine(road));
  const corridor = createCorridorIndex(lines);
  const band = createBandIndex(roads);
  const layout = tileLayout(enclosing(chordBoxes(lines, 0)), FIELD_MARGIN_M);

  const base = createBaseLattice(lines, {
    originX: layout.originX,
    originZ: layout.originZ,
    widthM: layout.columns * TILE_SIZE_M,
    depthM: layout.rows * TILE_SIZE_M,
  });

  const reachesRoad = roadReachTest(corridor);

  const field = createHeightfield(layout, {
    isFine: fineTileTest(layout, lines, lakes),
    heightAt: (x, z) => {
      const natural = lakes.reduce(
        (groundM, lake) => withLakeBasin(lake, { x, z }, groundM),
        baseHeightAt(base, x, z) + reliefAt(seed, x, z),
      );

      if (!reachesRoad(x, z)) return natural;

      const embankedM = corridorHeight(natural, corridorCandidates(corridor, x, z));

      return Math.min(embankedM, bandCeilingAt(band, x, z) - ROAD_SINK_M);
    },
  });

  return { field, corridor };
}
