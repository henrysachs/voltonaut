import type { RoadLine } from "./road-corridor.js";

/** Spacing of the smooth base lattice; base heights are bilinear between its points. */
export const BASE_SPACING_M = 32;

/** Road points every 32 m feed the base; farther than 600 m they no longer count. */
const BASE_SAMPLE_STRIDE = 8;
const BASE_REACH_M = 600;
const BASE_SOFTENING_M = 20;

/** Weight of the mean road height, about that of one road point 1 km away. */
const MEAN_WEIGHT = 1e-12;

export interface BaseLattice {
  readonly originX: number;
  readonly originZ: number;
  readonly columns: number;
  readonly rows: number;
  readonly heightsM: readonly number[];
}

export interface FieldExtent {
  readonly originX: number;
  readonly originZ: number;
  readonly widthM: number;
  readonly depthM: number;
}

interface BaseSample {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

function baseSamples(lines: readonly RoadLine[]): readonly BaseSample[] {
  return lines.flatMap((line) =>
    line.points.filter(
      (_, index) => index % BASE_SAMPLE_STRIDE === 0 || index === line.points.length - 1,
    ),
  );
}

function weightedHeight(
  samples: readonly BaseSample[],
  meanM: number,
  x: number,
  z: number,
): number {
  let weighted = MEAN_WEIGHT * meanM;
  let total = MEAN_WEIGHT;

  for (const sample of samples) {
    const distanceSq = (sample.x - x) ** 2 + (sample.z - z) ** 2;
    const reach = Math.max(0, 1 - distanceSq / BASE_REACH_M ** 2);
    const weight = reach ** 2 / (distanceSq + BASE_SOFTENING_M ** 2) ** 2;

    weighted += weight * sample.y;
    total += weight;
  }

  return weighted / total;
}

/**
 * Smooth ground that follows the roads: inverse-distance weighted road heights on a 32 m
 * lattice, fading to the mean road height far from every road.
 */
export function createBaseLattice(lines: readonly RoadLine[], extent: FieldExtent): BaseLattice {
  const samples = baseSamples(lines);
  const meanM = samples.reduce((sum, sample) => sum + sample.y, 0) / Math.max(1, samples.length);
  const columns = Math.round(extent.widthM / BASE_SPACING_M);
  const rows = Math.round(extent.depthM / BASE_SPACING_M);
  const heightsM: number[] = [];

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const x = extent.originX + column * BASE_SPACING_M;
      const z = extent.originZ + row * BASE_SPACING_M;

      heightsM.push(weightedHeight(samples, meanM, x, z));
    }
  }

  return { originX: extent.originX, originZ: extent.originZ, columns, rows, heightsM };
}

function latticeHeight(lattice: BaseLattice, column: number, row: number): number {
  const clampedColumn = Math.min(lattice.columns, Math.max(0, column));
  const clampedRow = Math.min(lattice.rows, Math.max(0, row));

  return lattice.heightsM[clampedRow * (lattice.columns + 1) + clampedColumn] ?? 0;
}

export function baseHeightAt(lattice: BaseLattice, x: number, z: number): number {
  const u = (x - lattice.originX) / BASE_SPACING_M;
  const v = (z - lattice.originZ) / BASE_SPACING_M;
  const column = Math.floor(u);
  const row = Math.floor(v);
  const fu = u - column;
  const fv = v - row;

  const top =
    latticeHeight(lattice, column, row) * (1 - fu) + latticeHeight(lattice, column + 1, row) * fu;

  const bottom =
    latticeHeight(lattice, column, row + 1) * (1 - fu) +
    latticeHeight(lattice, column + 1, row + 1) * fu;

  return top * (1 - fv) + bottom * fv;
}

/** Rolling hills of about ±8 m around a 3 m rise; the seed shifts their phase. */
export function reliefAt(seed: number, x: number, z: number): number {
  const phase = (seed * 2.399_963) % (Math.PI * 2);

  return (
    3 +
    5 * Math.sin(0.017 * x + 0.012 * z + phase) +
    3 * Math.cos(0.031 * z - 0.011 * x + 2 * phase)
  );
}
