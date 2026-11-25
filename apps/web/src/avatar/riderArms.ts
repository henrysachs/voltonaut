import type * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { lerp, smoothPath } from "./bikeSweep.js";
import type { ArmPose } from "./pose.js";
import { inBand, KIT_ATLAS, PLAIN_SKIN_UV } from "./riderAtlas.js";
import { bump, chain, extend, muscle, UPWARD } from "./riderMuscle.js";
import { bonesOfSide, type BoneSegments } from "./riderRig.js";
import type { SkinBucket } from "./riderSkin.js";
import { roundedEnds, tube, type TubeSection } from "./riderSurface.js";
import { envelope, rigid } from "./riderWeights.js";

/** Upper arm with deltoid and biceps, forearm with its muscle belly near the elbow. */
function armSection(
  segment: 0 | 1,
  t: number,
  angleRad: number,
  scale = 1,
): readonly [number, number] {
  const [across, along] =
    segment === 0
      ? muscle(
          lerp(0.05, 0.039, t) + 0.008 * bump(t, 0.12, 0.2),
          lerp(0.055, 0.04, t),
          0.12 * bump(t, 0.55, 0.45),
          0.08 * bump(t, 0.45, 0.4),
          angleRad,
        )
      : muscle(
          lerp(0.039, 0.028, t) + 0.006 * bump(t, 0.22, 0.3),
          lerp(0.038, 0.021, t),
          0.16 * bump(t, 0.25, 0.35),
          0.06 * bump(t, 0.2, 0.3),
          angleRad,
        );

  return [across * scale, along * scale];
}

export function addArm(
  bucket: Readonly<SkinBucket>,
  arm: Readonly<ArmPose>,
  bind: BoneSegments,
  side: 1 | -1,
): void {
  const names = bonesOfSide(side);
  const weights = envelope(bind, ["Spine2", names.shoulder, names.arm, names.foreArm, names.hand]);
  const points = [extend(arm.shoulder, arm.elbow, 0.03), arm.elbow, arm.wrist] as const;
  const sleeve = chain(points, [0, 0.31], 12);
  const skin = chain(points, [0.22, 1], 26);

  bucket.add(
    "kit",
    tube(
      sleeve.path,
      (t, angle) => armSection(...sleeve.at(t), angle, 1.1 + 0.06 * Math.max(0, 1 - t * 3)),
      { forward: UPWARD, segments: 22, uv: inBand(KIT_ATLAS.sleeve) },
    ),
    weights,
  );
  bucket.add(
    "skin",
    tube(skin.path, (t, angle) => armSection(...skin.at(t), angle), {
      forward: UPWARD,
      segments: 18,
    }),
    weights,
    PLAIN_SKIN_UV,
  );
}

function fingerSection(radiusM: number, lengthM: number): TubeSection {
  return (t, angle) => {
    const round = roundedEnds(t, 0, radiusM, lengthM);

    return muscle(
      radiusM * lerp(1, 0.82, t) * round,
      radiusM * lerp(0.95, 0.78, t) * round,
      0.08,
      0,
      angle,
    );
  };
}

/** Glove palm and back from the wrist to the knuckles, rounded at the front. */
function palm(at: (x: number, y: number, z: number) => Point3): THREE.BufferGeometry {
  const path = smoothPath(
    [at(-0.06, 0.03, 0), at(-0.02, 0.013, 0), at(0.02, 0.004, 0.001), at(0.046, 0.0, 0.002)],
    10,
  );

  return tube(
    path,
    (t, angle) => {
      const round = roundedEnds(t, 0, 0.02, 0.11);
      const across = lerp(0.034, 0.045, Math.min(1, t * 1.4));
      const [x, y] = muscle(across, lerp(0.024, 0.017, t), 0.25, 0.1, angle);

      return [x * round, y * round];
    },
    { forward: UPWARD, segments: 14 },
  );
}

/** Finger draped over the hood; the little finger is shorter and thinner. */
function finger(
  at: (x: number, y: number, z: number) => Point3,
  index: number,
  offsetM: number,
): THREE.BufferGeometry {
  const reach = index === 3 ? 0.8 : index === 0 ? 0.92 : 1;

  const path = smoothPath(
    [
      at(0.022, 0.004, offsetM),
      at(0.046 * reach + 0.006, 0.0, offsetM * 0.92 + 0.004),
      at(0.066 * reach + 0.004, -0.014, offsetM * 0.82 + 0.012),
      at(0.07 * reach, -0.033 * reach, offsetM * 0.72 + 0.018),
      at(0.06 * reach, -0.048 * reach, offsetM * 0.65 + 0.02),
    ],
    9,
  );

  return tube(path, fingerSection(index === 3 ? 0.0074 : 0.0086, 0.09), {
    forward: UPWARD,
    segments: 8,
  });
}

/** Thumb wrapped around the inside of the hood. */
function thumb(at: (x: number, y: number, z: number) => Point3): THREE.BufferGeometry {
  const path = smoothPath(
    [
      at(-0.025, 0.004, -0.03),
      at(0.004, -0.014, -0.04),
      at(0.03, -0.024, -0.036),
      at(0.05, -0.026, -0.026),
    ],
    10,
  );

  return tube(path, fingerSection(0.011, 0.08), { forward: UPWARD, segments: 10 });
}

/**
 * Fingerless glove on the hood: padded palm and back, four fingers draped over the hood and
 * the thumb wrapped around its inside. Built around the bind grip point.
 */
export function addHand(
  bucket: Readonly<SkinBucket>,
  arm: Readonly<ArmPose>,
  bind: BoneSegments,
  side: 1 | -1,
): void {
  const names = bonesOfSide(side);
  const hand = rigid(names.hand);
  const g = arm.grip;
  const at = (x: number, y: number, z: number): Point3 => [g[0] + x, g[1] + y, g[2] + side * z];

  bucket.add("dark", palm(at), envelope(bind, [names.foreArm, names.hand]));

  for (const [index, offsetM] of [0.028, 0.0095, -0.0095, -0.027].entries()) {
    bucket.add("skin", finger(at, index, offsetM), hand, PLAIN_SKIN_UV);
  }

  bucket.add("skin", thumb(at), hand, PLAIN_SKIN_UV);
}
