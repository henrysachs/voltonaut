import type { ItemBox } from "./cell-grid.js";

/** Tile edge length (docs/04-world-3d.md §4, ADR-033 §5). */
export const TILE_SIZE_M = 256;

/** Point spacing of tiles near roads and the lake, and elsewhere; the fine one divides the coarse. */
export const FINE_SPACING_M = 8;
export const COARSE_SPACING_M = 32;

export interface TerrainTile {
  readonly column: number;
  readonly row: number;
  readonly originX: number;
  readonly originZ: number;
  readonly spacingM: number;
  readonly cells: number;
  /** Row-major (cells + 1)² heights; row runs along +z, column along +x. */
  readonly heightsM: readonly number[];
}

export interface TileLayout {
  readonly originX: number;
  readonly originZ: number;
  readonly columns: number;
  readonly rows: number;
}

export interface Heightfield extends TileLayout {
  readonly tiles: readonly TerrainTile[];
}

export interface HeightSource {
  readonly isFine: (column: number, row: number) => boolean;
  readonly heightAt: (x: number, z: number) => number;
}

/** Tiles aligned to multiples of TILE_SIZE_M that cover the bounds plus marginM on every side. */
export function tileLayout(bounds: ItemBox, marginM: number): TileLayout {
  const originX = Math.floor((bounds.minX - marginM) / TILE_SIZE_M) * TILE_SIZE_M;
  const originZ = Math.floor((bounds.minZ - marginM) / TILE_SIZE_M) * TILE_SIZE_M;
  const endX = Math.ceil((bounds.maxX + marginM) / TILE_SIZE_M) * TILE_SIZE_M;
  const endZ = Math.ceil((bounds.maxZ + marginM) / TILE_SIZE_M) * TILE_SIZE_M;

  return {
    originX,
    originZ,
    columns: (endX - originX) / TILE_SIZE_M,
    rows: (endZ - originZ) / TILE_SIZE_M,
  };
}

function sampleTile(
  layout: TileLayout,
  source: HeightSource,
  column: number,
  row: number,
): TerrainTile {
  const spacingM = source.isFine(column, row) ? FINE_SPACING_M : COARSE_SPACING_M;
  const cells = TILE_SIZE_M / spacingM;
  const originX = layout.originX + column * TILE_SIZE_M;
  const originZ = layout.originZ + row * TILE_SIZE_M;
  const heightsM: number[] = [];

  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) {
      heightsM.push(source.heightAt(originX + i * spacingM, originZ + j * spacingM));
    }
  }

  return { column, row, originX, originZ, spacingM, cells, heightsM };
}

function vertexIndex(cells: number, i: number, j: number): number {
  return j * (cells + 1) + i;
}

/** Border vertex k of a tile side, as (i, j); sides: 0 west, 1 east, 2 north (−z), 3 south (+z). */
function sideVertex(cells: number, side: number, k: number): readonly [number, number] {
  if (side === 0) return [0, k];

  if (side === 1) return [cells, k];

  return side === 2 ? [k, 0] : [k, cells];
}

function tileHeight(tile: TerrainTile, i: number, j: number): number {
  return tile.heightsM[vertexIndex(tile.cells, i, j)] ?? 0;
}

interface Neighbour {
  readonly side: number;
  readonly tile: TerrainTile;
}

/** Height on the straight edge of the coarse neighbour at border vertex k of the fine tile. */
function coarseEdgeHeight(fine: TerrainTile, neighbour: Neighbour, k: number): number {
  const coarse = neighbour.tile;
  const ratio = coarse.spacingM / fine.spacingM;
  const opposite = neighbour.side % 2 === 0 ? neighbour.side + 1 : neighbour.side - 1;
  const low = Math.floor(k / ratio);
  const fraction = k / ratio - low;
  const lowM = tileHeight(coarse, ...sideVertex(coarse.cells, opposite, low));

  if (fraction === 0) return lowM;

  const highM = tileHeight(coarse, ...sideVertex(coarse.cells, opposite, low + 1));

  return lowM + fraction * (highM - lowM);
}

/** Puts every border of a fine tile onto the straight edge of a coarse neighbour (no T-cracks). */
function stitchedHeights(tile: TerrainTile, coarse: readonly Neighbour[]): readonly number[] {
  const heightsM = [...tile.heightsM];

  for (const neighbour of coarse) {
    for (let k = 0; k <= tile.cells; k += 1) {
      heightsM[vertexIndex(tile.cells, ...sideVertex(tile.cells, neighbour.side, k))] =
        coarseEdgeHeight(tile, neighbour, k);
    }
  }

  return heightsM;
}

interface SideCell {
  readonly side: number;
  readonly column: number;
  readonly row: number;
}

function coarserNeighbours(
  layout: TileLayout,
  tiles: readonly TerrainTile[],
  tile: TerrainTile,
): readonly Neighbour[] {
  const sides: readonly SideCell[] = [
    { side: 0, column: tile.column - 1, row: tile.row },
    { side: 1, column: tile.column + 1, row: tile.row },
    { side: 2, column: tile.column, row: tile.row - 1 },
    { side: 3, column: tile.column, row: tile.row + 1 },
  ];

  return sides.flatMap(({ side, column, row }) => {
    const inside = column >= 0 && row >= 0 && column < layout.columns && row < layout.rows;
    const other = inside ? tiles[row * layout.columns + column] : undefined;

    return other !== undefined && other.spacingM > tile.spacingM ? [{ side, tile: other }] : [];
  });
}

/** Samples every tile, then stitches fine borders onto coarse neighbours. */
export function createHeightfield(layout: TileLayout, source: HeightSource): Heightfield {
  const sampled: TerrainTile[] = [];

  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      sampled.push(sampleTile(layout, source, column, row));
    }
  }

  const tiles: TerrainTile[] = [];

  for (const tile of sampled) {
    const coarse = coarserNeighbours(layout, sampled, tile);

    tiles.push(coarse.length === 0 ? tile : { ...tile, heightsM: stitchedHeights(tile, coarse) });
  }

  return { ...layout, tiles };
}

/** Tile containing a point; points outside the field use the nearest border tile. */
export function tileAt(field: Heightfield, x: number, z: number): TerrainTile {
  const column = Math.min(
    field.columns - 1,
    Math.max(0, Math.floor((x - field.originX) / TILE_SIZE_M)),
  );

  const row = Math.min(field.rows - 1, Math.max(0, Math.floor((z - field.originZ) / TILE_SIZE_M)));
  const tile = field.tiles[row * field.columns + column];

  if (tile === undefined) throw new RangeError(`terrain tile ${column}:${row} is missing`);

  return tile;
}

/**
 * Height of the drawn triangle mesh: every cell splits along its (i, j)–(i + 1, j + 1)
 * diagonal into the triangles (a, c, d) and (a, d, b), exactly like terrain.ts.
 */
export function heightAt(field: Heightfield, x: number, z: number): number {
  const tile = tileAt(field, x, z);
  const u = Math.min(tile.cells, Math.max(0, (x - tile.originX) / tile.spacingM));
  const v = Math.min(tile.cells, Math.max(0, (z - tile.originZ) / tile.spacingM));
  const i = Math.min(tile.cells - 1, Math.floor(u));
  const j = Math.min(tile.cells - 1, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const a = tileHeight(tile, i, j);
  const b = tileHeight(tile, i + 1, j);
  const c = tileHeight(tile, i, j + 1);
  const d = tileHeight(tile, i + 1, j + 1);

  return fv >= fu ? a + fu * (d - c) + fv * (c - a) : a + fu * (b - a) + fv * (d - b);
}

/** Rim points sampled around a round base; 32 keep a 2.7 m base on a 1:1 slope within 2 cm. */
const RIM_SAMPLES = 32;

/** A round base on the ground: its rim radius and how far it is sunk below its centre's ground. */
export interface Foot {
  readonly radiusM: number;
  readonly sinkM: number;
}

/**
 * Ground height to stand a base on: the drawn height under its centre, lowered on a slope until
 * the base, sunk foot.sinkM below it, reaches the terrain under its whole rim (#138). On ground
 * that falls less than sinkM across the base it is the centre height unchanged.
 */
export function settledHeightAt(field: Heightfield, x: number, z: number, foot: Foot): number {
  let rimM = Number.POSITIVE_INFINITY;

  for (let index = 0; index < RIM_SAMPLES; index += 1) {
    const angleRad = (index / RIM_SAMPLES) * Math.PI * 2;
    const rimX = x + Math.cos(angleRad) * foot.radiusM;
    const rimZ = z + Math.sin(angleRad) * foot.radiusM;

    rimM = Math.min(rimM, heightAt(field, rimX, rimZ));
  }

  return Math.min(heightAt(field, x, z), rimM + foot.sinkM);
}
