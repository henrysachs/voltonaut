/** Axis-aligned XZ box of one indexed item. */
export interface ItemBox {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/**
 * Uniform XZ buckets of item indices for range queries. Each item sits once, in the cell of its
 * box centre; queries widen by the largest half box so no overlapping item is missed.
 */
export interface CellGrid {
  readonly originX: number;
  readonly originZ: number;
  readonly cellM: number;
  readonly columns: number;
  readonly rows: number;
  /** Largest distance from a box centre to its edge along either axis. */
  readonly reachM: number;
  readonly boxes: readonly ItemBox[];
  readonly buckets: readonly (readonly number[])[];
}

type GridLayout = Pick<CellGrid, "originX" | "originZ" | "cellM" | "columns" | "rows">;

function cellOf(layout: GridLayout, valueM: number, axis: "x" | "z"): number {
  const origin = axis === "x" ? layout.originX : layout.originZ;
  const count = axis === "x" ? layout.columns : layout.rows;

  return Math.min(count - 1, Math.max(0, Math.floor((valueM - origin) / layout.cellM)));
}

/** Buckets every box by its centre. */
export function createCellGrid(boxes: readonly ItemBox[], cellM: number): CellGrid {
  const centersX = boxes.map((box) => (box.minX + box.maxX) / 2);
  const centersZ = boxes.map((box) => (box.minZ + box.maxZ) / 2);
  const originX = Math.floor(Math.min(...centersX) / cellM) * cellM;
  const originZ = Math.floor(Math.min(...centersZ) / cellM) * cellM;
  const columns = Math.max(0, Math.floor((Math.max(...centersX) - originX) / cellM) + 1);
  const rows = Math.max(0, Math.floor((Math.max(...centersZ) - originZ) / cellM) + 1);
  const layout = { originX, originZ, cellM, columns, rows };
  const buckets: number[][] = Array.from({ length: columns * rows }, () => []);

  const reachM = Math.max(
    0,
    ...boxes.map((box) => Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2),
  );

  for (const [item, box] of boxes.entries()) {
    const column = cellOf(layout, (box.minX + box.maxX) / 2, "x");
    const row = cellOf(layout, (box.minZ + box.maxZ) / 2, "z");

    buckets[row * columns + column]?.push(item);
  }

  return { ...layout, reachM, boxes, buckets };
}

/** Indices of every item whose box overlaps the square of ±rangeM around (x, z), once each. */
export function itemsNear(grid: CellGrid, x: number, z: number, rangeM: number): readonly number[] {
  const searchM = rangeM + grid.reachM;
  const items: number[] = [];

  if (grid.columns === 0) return items;

  const lastColumn = cellOf(grid, x + searchM, "x");
  const lastRow = cellOf(grid, z + searchM, "z");

  for (let row = cellOf(grid, z - searchM, "z"); row <= lastRow; row += 1) {
    for (let column = cellOf(grid, x - searchM, "x"); column <= lastColumn; column += 1) {
      for (const item of grid.buckets[row * grid.columns + column] ?? []) {
        const box = grid.boxes[item];

        if (
          box !== undefined &&
          box.minX <= x + rangeM &&
          box.maxX >= x - rangeM &&
          box.minZ <= z + rangeM &&
          box.maxZ >= z - rangeM
        ) {
          items.push(item);
        }
      }
    }
  }

  return items;
}
