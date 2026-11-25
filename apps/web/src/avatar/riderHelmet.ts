import type * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { lerp, smoothPath } from "./bikeSweep.js";
import type { SkinBucket } from "./riderSkin.js";
import type { HelmetSpec } from "./riderSpecs.js";
import { ellipsoid, surfaceGeometry, tube } from "./riderSurface.js";
import { rigid } from "./riderWeights.js";

/**
 * Helmet surface in head space: γ ∈ [-π/2, π/2] runs across the head (ear to ear), β from the
 * brow over the top to the nape. Aero helmets stretch into a tail; vents are sunk into the shell.
 */
const HELMET_CENTRE: Point3 = [-0.004, 0.126, 0];
export const BETA_FRONT = 0.02;
export const BETA_BACK = Math.PI + 0.4;
const GAMMA_EDGE = Math.PI / 2;
const HEAD = rigid("Head");

/** Vent as (γ, β, half width in γ, half length in β). */
export type Vent = readonly [number, number, number, number];

/** Vent centres and sizes; one list for the sunk geometry and the painted openings. */
function helmetVents(spec: Readonly<HelmetSpec>): readonly Vent[] {
  const vents: Vent[] = [];
  const halfBeta = spec.ventLengthM / 2 / spec.shellM[1];

  for (const [column, count] of spec.ventRows.entries()) {
    for (const side of column === 0 ? [0] : [1, -1]) {
      for (let vent = 0; vent < count; vent += 1) {
        const beta = lerp(0.62, 2.3, count === 1 ? 0.3 : vent / (count - 1)) + column * 0.14;

        vents.push([
          side * column * 0.36,
          beta,
          0.075 - column * 0.008,
          halfBeta * (1 - column * 0.1),
        ]);
      }
    }
  }

  return vents;
}

const VENT_CACHE = new WeakMap<HelmetSpec, readonly Vent[]>();

/** Vent list of a spec, computed once. */
export function ventsOf(spec: Readonly<HelmetSpec>): readonly Vent[] {
  const cached = VENT_CACHE.get(spec);

  if (cached !== undefined) return cached;

  const vents = helmetVents(spec);

  VENT_CACHE.set(spec, vents);

  return vents;
}

/** 0…1: how deep a point lies inside a vent (smooth falloff at the vent edge). */
export function ventMask(vents: readonly Vent[], gamma: number, beta: number): number {
  let mask = 0;

  for (const [g, b, halfG, halfB] of vents) {
    const d = ((gamma - g) / halfG) ** 2 + ((beta - b) / halfB) ** 2;

    if (d < 1) mask = Math.max(mask, Math.min(1, (1 - d) * 4));
  }

  return mask;
}

export function helmetPoint(
  spec: Readonly<HelmetSpec>,
  gamma: number,
  beta: number,
  scale = 1,
  vents = true,
): Point3 {
  const [rx, ry, rz] = spec.shellM;
  const cosGamma = Math.cos(gamma);
  const dx = cosGamma * Math.cos(beta);
  const dy = cosGamma * Math.sin(beta);
  const dz = Math.sin(gamma);
  const back = Math.max(0, -dx) ** 2 * cosGamma ** 2;
  // Flatter sides like a modern road helmet.
  const flank = 1 - 0.06 * dy * Math.abs(dz);
  const s = scale * (vents ? 1 - 0.035 * ventMask(ventsOf(spec), gamma, beta) : 1);

  return [
    HELMET_CENTRE[0] + (dx * rx - spec.tailM * back) * s,
    HELMET_CENTRE[1] + (dy * ry - spec.tailM * 0.3 * back) * s,
    HELMET_CENTRE[2] + dz * rz * flank * s * (1 - 0.4 * back * Math.min(1, spec.tailM * 8)),
  ];
}

function gammaOf(u: number): number {
  return lerp(-GAMMA_EDGE, GAMMA_EDGE, u);
}

function betaOf(v: number): number {
  return lerp(BETA_FRONT, BETA_BACK, v);
}

/** Flat webbing strap through the given points. */
export function strap(points: readonly Point3[]): THREE.BufferGeometry {
  return tube(
    smoothPath(points, points.length > 2 ? 10 : 4),
    (_, angle) => [Math.cos(angle) * 0.0017, Math.sin(angle) * 0.0075],
    { lateral: [0, 0, 1], forward: [1, 0, 0], segments: 6 },
  );
}

/** Shell (painted vents), liner and the rim band that joins them front and back. */
function addShell(
  bucket: Readonly<SkinBucket>,
  spec: Readonly<HelmetSpec>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once per part.
  head: Readonly<THREE.Matrix4>,
): void {
  const shell = surfaceGeometry((u, v) => helmetPoint(spec, gammaOf(u), betaOf(v)), 34, 38);

  const liner = surfaceGeometry(
    (u, v) => helmetPoint(spec, gammaOf(u), betaOf(v), 0.9, false),
    12,
    10,
    {
      flip: true,
    },
  );

  bucket.add("helmet", shell, HEAD, undefined, head);
  bucket.add("dark", liner, HEAD, undefined, head);

  for (const v of [0, 1]) {
    const rim = surfaceGeometry(
      (u, w) => helmetPoint(spec, gammaOf(u), betaOf(v), lerp(1.002, 0.9, w), false),
      34,
      1,
      { flip: v === 0 },
    );

    bucket.add("dark", rim, HEAD, undefined, head);
  }
}

/** Integrated visor of aero helmets, in front of the eyes. */
function visor(): THREE.BufferGeometry {
  return surfaceGeometry(
    (u, v) => {
      const angle = lerp(-1.05, 1.05, u);
      const round = Math.min(1, (u * (1 - u)) / 0.05);

      return [
        0.006 + 0.146 * Math.cos(angle),
        lerp(0.13 - 0.052 * Math.sqrt(round), 0.13, v) - 0.012 * angle ** 2,
        0.116 * Math.sin(angle),
      ];
    },
    20,
    4,
  );
}

/** Chin straps: a Y around each ear down to a buckle under the chin. */
function addStraps(
  bucket: Readonly<SkinBucket>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once per part.
  head: Readonly<THREE.Matrix4>,
): void {
  for (const side of [1, -1] as const) {
    const junction: Point3 = [0.016, 0.05, side * 0.082];

    const straps = [
      strap([[0.058, 0.14, side * 0.098], [0.04, 0.09, side * 0.088], junction]),
      strap([[-0.045, 0.124, side * 0.098], [-0.01, 0.08, side * 0.088], junction]),
      strap([
        junction,
        [0.04, 0.012, side * 0.07],
        [0.07, -0.016, side * 0.04],
        [0.086, -0.026, side * 0.012],
      ]),
    ];

    for (const geometry of straps) bucket.add("dark", geometry, HEAD, undefined, head);
  }

  bucket.add(
    "dark",
    ellipsoid([0.088, -0.026, 0], [0.008, 0.007, 0.02], 10, 6),
    HEAD,
    undefined,
    head,
  );
}

export function addHelmet(
  bucket: Readonly<SkinBucket>,
  spec: Readonly<HelmetSpec>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once per part.
  head: Readonly<THREE.Matrix4>,
): void {
  addShell(bucket, spec, head);
  addStraps(bucket, head);

  if (spec.visor) bucket.add("lens", visor(), HEAD, undefined, head);
}
