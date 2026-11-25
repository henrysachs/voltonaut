import type * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { lerp } from "./bikeSweep.js";
import { strap } from "./riderHelmet.js";
import type { SkinBucket } from "./riderSkin.js";
import type { GlassesSpec, LensCut } from "./riderSpecs.js";
import { roundedEnds, surfaceGeometry, tube } from "./riderSurface.js";
import { rigid } from "./riderWeights.js";

const HEAD = rigid("Head");

/** Point on the wrap-around lens cylinder in front of the eyes (head space). */
function lensPoint(angle: number, y: number): Point3 {
  return [0.006 + 0.112 * Math.cos(angle), y, 0.094 * Math.sin(angle)];
}

function lensTop(angle: number): number {
  return 0.126 - 0.006 * angle ** 2;
}

/** One lens between two wrap angles; the shield gets a nose cut-out at the centre. */
function lens(cut: LensCut, from: number, to: number): THREE.BufferGeometry {
  return surfaceGeometry(
    (u, v) => {
      const angle = lerp(from, to, u);
      const ends = Math.min(1, (u * (1 - u)) / 0.05);
      const nose = cut === "shield" ? 0.024 * Math.exp(-((angle / 0.16) ** 2)) : 0;
      const bottom = 0.086 + 0.012 * angle ** 2 + nose;
      const height = (lensTop(angle) - bottom) * (0.3 + 0.7 * Math.sqrt(ends));

      return lensPoint(angle, lensTop(angle) - height * v);
    },
    24,
    5,
  );
}

/** Top bar of the frame along the upper lens edge. */
function frameBar(): THREE.BufferGeometry {
  const path = Array.from({ length: 21 }, (_, index): Point3 => {
    const angle = lerp(-1.03, 1.03, index / 20);

    return lensPoint(angle, lensTop(angle) + 0.002);
  });

  return tube(
    path,
    (t, angle) => {
      const round = roundedEnds(t, 0.004, 0.004, 0.24);

      return [Math.cos(angle) * 0.0034 * round, Math.sin(angle) * 0.0026 * round];
    },
    { lateral: [0, 1, 0], forward: [1, 0, 0], segments: 6 },
  );
}

/** Sport glasses: shield or dual lenses, frame bar and temples tucked under the straps. */
export function addGlasses(
  bucket: Readonly<SkinBucket>,
  spec: Readonly<GlassesSpec>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three matrices are mutable value objects read once per part.
  head: Readonly<THREE.Matrix4>,
): void {
  if (spec.lens === undefined) return;

  const { cut } = spec.lens;

  const spans: readonly (readonly [number, number])[] =
    cut === "shield"
      ? [[-1, 1]]
      : [
          [0.08, 1],
          [-1, -0.08],
        ];

  for (const [from, to] of spans) bucket.add("lens", lens(cut, from, to), HEAD, undefined, head);

  bucket.add("dark", frameBar(), HEAD, undefined, head);

  for (const side of [1, -1] as const) {
    const hinge = lensPoint(side * 1.02, lensTop(1.02) + 0.002);
    const temple = strap([hinge, [0.03, 0.118, side * 0.088], [-0.004, 0.112, side * 0.084]]);

    bucket.add("dark", temple, HEAD, undefined, head);
  }
}
