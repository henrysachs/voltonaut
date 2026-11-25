import type * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { lerp, smoothPath } from "./bikeSweep.js";
import { inBand, PLAIN_SKIN_UV, SKIN_ATLAS } from "./riderAtlas.js";
import type { SkinBucket } from "./riderSkin.js";
import { ellipsoid, roundedEnds, surfaceGeometry, tube } from "./riderSurface.js";
import { rigid } from "./riderWeights.js";

/**
 * Head space: origin at the top of the neck, +X forward (face), +Y up the head axis, +Z right.
 * Everything here is rigid on the `Head` bone.
 */
const SKULL_CENTRE: Point3 = [0.018, 0.108, 0];
const SKULL_RADII: Point3 = [0.096, 0.118, 0.077];
const TAU = Math.PI * 2;
const HEAD = rigid("Head");

/** Eye centre (right side; mirror z for the left). */
export const EYE: Point3 = [0.089, 0.106, 0.032];
const EYE_RADIUS_M = 0.0118;

function gauss(value: number, width: number): number {
  return Math.exp(-((value / width) ** 2));
}

/** Smooth offsets that sculpt brow ridge, eye sockets, cheekbones and nose bridge. */
function facialRelief(y: number, across: number, face: number): number {
  const brow = gauss(y - 0.124, 0.012) * gauss(across - 0.034, 0.03) * face ** 3;
  const socket = gauss(y - EYE[1], 0.013) * gauss(across - EYE[2], 0.016) * face ** 3;
  const cheek = gauss(y - 0.078, 0.02) * gauss(across - 0.048, 0.02) * face ** 2;
  const bridge = gauss(y - 0.1, 0.02) * gauss(across, 0.012) * face ** 4;

  return 0.006 * brow - 0.011 * socket + 0.005 * cheek + 0.008 * bridge;
}

/**
 * Sculpted skull, u = azimuth (0 = face, 0.25 = right), v = chin → crown: an ellipsoid with a
 * narrower jaw, a chin, a pulled-in nape, slight temples and the facial relief.
 */
export function skullPoint(u: number, v: number): Point3 {
  const azimuth = u * TAU;
  const polar = Math.PI * (1 - v);
  const dx = Math.sin(polar) * Math.cos(azimuth);
  const dy = Math.cos(polar);
  const dz = Math.sin(polar) * Math.sin(azimuth);
  const lower = Math.max(0, -dy);
  const face = Math.max(0, dx);
  const jaw = 1 - 0.3 * lower ** 1.3 * (0.6 + 0.4 * face);
  const nape = dx < 0 ? 1 - 0.34 * lower - 0.05 * Math.max(0, -dy + 0.3) : 1;
  const chin = 1 + 0.12 * face ** 4 * gauss(dy + 0.75, 0.2);
  const y = SKULL_CENTRE[1] + dy * SKULL_RADII[1];
  const z = SKULL_CENTRE[2] + dz * SKULL_RADII[2] * jaw;
  const temple = gauss(y - 0.12, 0.03) * gauss(dz * dz - 0.6, 0.3) * 0.004;

  return [
    SKULL_CENTRE[0] + dx * SKULL_RADII[0] * nape * chin + facialRelief(y, Math.abs(z), face),
    y,
    z - Math.sign(z) * temple,
  ];
}

function nose(): THREE.BufferGeometry {
  const path = smoothPath(
    [
      [0.098, 0.108, 0],
      [0.108, 0.092, 0],
      [0.118, 0.074, 0],
      [0.116, 0.066, 0],
    ],
    12,
  );

  return tube(
    path,
    (t, angle) => {
      const round = roundedEnds(t, 0, 0.012, 0.05);
      const wing = 1 + 0.6 * Math.max(0, t - 0.6);

      return [
        Math.cos(angle) * lerp(0.0055, 0.0095, t) * wing * round,
        Math.sin(angle) * lerp(0.006, 0.0095, t) * round,
      ];
    },
    { lateral: [0, 0, 1], forward: [1, 0, 0], segments: 14 },
  );
}

/** Ear: a flattened shell tilted back, its rim slightly thicker than the centre. */
function ear(side: 1 | -1): THREE.BufferGeometry {
  return surfaceGeometry(
    (u, radius) => {
      const angle = u * TAU;
      const rim = 1 + 0.25 * radius ** 4;

      return [
        0.006 + Math.cos(angle) * 0.018 * radius - 0.006 * Math.sin(angle) * radius,
        0.094 + Math.sin(angle) * 0.03 * radius,
        side * (0.073 + 0.012 * radius ** 2 * rim - 0.004 * (1 - radius)),
      ];
    },
    16,
    4,
    { wrapU: true, flip: side === -1 },
  );
}

/** Upper lid: a skin cap over the top of the eyeball, so the eye looks relaxed, not staring. */
function eyelid(side: 1 | -1): THREE.BufferGeometry {
  const radiusM = EYE_RADIUS_M * 1.12;

  return surfaceGeometry(
    (u, v) => {
      const azimuth = lerp(-1.5, 1.5, u);
      const polar = lerp(0, 1.25, v);

      return [
        EYE[0] + Math.sin(polar) * Math.cos(azimuth) * radiusM,
        EYE[1] + Math.cos(polar) * radiusM * 0.95,
        side * EYE[2] + Math.sin(polar) * Math.sin(azimuth) * radiusM,
      ];
    },
    12,
    5,
    { flip: true },
  );
}

/** Skull with painted face and hair, nose, ears, eyeballs with painted irises and lids. */
export function addFace(
  bucket: Readonly<SkinBucket>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once per part.
  head: Readonly<THREE.Matrix4>,
): void {
  const skull = surfaceGeometry(skullPoint, 36, 28, { wrapU: true, uv: inBand(SKIN_ATLAS.face) });

  bucket.add("skin", skull, HEAD, undefined, head);
  bucket.add("skin", nose(), HEAD, PLAIN_SKIN_UV, head);

  for (const side of [1, -1] as const) {
    const centre: Point3 = [EYE[0], EYE[1], side * EYE[2]];
    const radii: Point3 = [EYE_RADIUS_M, EYE_RADIUS_M, EYE_RADIUS_M];

    bucket.add("skin", ear(side), HEAD, PLAIN_SKIN_UV, head);
    // Iris on the +x pole of the eyeball: u = 0 faces forward.
    bucket.add(
      "skin",
      ellipsoid(centre, radii, 12, 8, inBand(SKIN_ATLAS.eye)),
      HEAD,
      undefined,
      head,
    );
    bucket.add("skin", eyelid(side), HEAD, PLAIN_SKIN_UV, head);
  }
}
