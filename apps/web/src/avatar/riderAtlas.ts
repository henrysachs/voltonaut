import type { Point2 } from "./bikeSweep.js";

/**
 * Texture atlas layout shared by the geometry (UVs) and the painters. Every range is a band of
 * the texture's v axis; u always runs around the part.
 */
export const KIT_ATLAS = {
  torso: [0, 0.7],
  sleeve: [0.72, 0.85],
  leg: [0.87, 1],
} as const;

export const SKIN_ATLAS = {
  face: [0, 0.62],
  eye: [0.66, 0.8],
  plain: [0.86, 1],
} as const;

/** Plain skin texel for parts without their own UVs (arms, legs, hands, nose, ears). */
export const PLAIN_SKIN_UV: Point2 = [0.5, 0.93];

export type AtlasBand = readonly [number, number];

/** Maps a part's (u, v) into its band of the atlas. */
export function inBand(band: AtlasBand): (u: number, v: number) => Point2 {
  return (u, v) => [u, band[0] + (band[1] - band[0]) * v];
}

/** Inverse of `inBand` for the painters; `undefined` outside the band. */
export function fromBand(band: AtlasBand, v: number): number | undefined {
  if (v < band[0] || v > band[1]) return undefined;

  return (v - band[0]) / (band[1] - band[0]);
}

/**
 * Torso spine coordinate `s`: bibs below 0, jersey hem at JERSEY_HEM_S, neck opening at COLLAR_S.
 * The torso texture's v runs linearly from BIBS_START_S to COLLAR_S.
 */
export const BIBS_START_S = -0.31;
export const JERSEY_HEM_S = -0.12;
export const COLLAR_S = 1.05;

export function torsoS(v: number): number {
  return BIBS_START_S + (COLLAR_S - BIBS_START_S) * v;
}

/** Jersey panel height t ∈ [0, 1] (hem → collar) on the spine coordinate. */
export function panelS(t: number): number {
  return JERSEY_HEM_S + 0.04 + (COLLAR_S - 0.07 - (JERSEY_HEM_S + 0.04)) * t;
}

/** Rear pockets: spine range and centre angles (3π/2 = middle of the back). */
export const POCKET_S: readonly [number, number] = [JERSEY_HEM_S + 0.03, 0.17];
export const POCKET_HALF_ANGLE_RAD = 0.2;

export const POCKET_CENTRES_RAD: readonly number[] = [
  (Math.PI * 3) / 2 - 0.44,
  (Math.PI * 3) / 2,
  (Math.PI * 3) / 2 + 0.44,
];

/** How far (0…1) a point sits inside one of the rear pockets. */
export function pocketMask(s: number, angleRad: number): number {
  if (s < POCKET_S[0] || s > POCKET_S[1]) return 0;

  const sT = (s - POCKET_S[0]) / (POCKET_S[1] - POCKET_S[0]);
  let best = 0;

  for (const centre of POCKET_CENTRES_RAD) {
    const across = 1 - Math.abs(angleRad - centre) / POCKET_HALF_ANGLE_RAD;

    if (across > 0) best = Math.max(best, Math.sin(Math.PI * Math.min(1, across * 1.6) * 0.5));
  }

  return best * Math.sin(Math.PI * Math.min(1, sT * 1.25) * 0.5) * Math.min(1, (1 - sT) * 6);
}
