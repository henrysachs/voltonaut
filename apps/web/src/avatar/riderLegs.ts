import { add3, lerp } from "./bikeSweep.js";
import type { LegPose } from "./pose.js";
import { inBand, KIT_ATLAS, PLAIN_SKIN_UV } from "./riderAtlas.js";
import { bump, chain, extend, LEG_FRONT, muscle } from "./riderMuscle.js";
import { bonesOfSide, type BoneSegments } from "./riderRig.js";
import type { SkinBucket } from "./riderSkin.js";
import { tube } from "./riderSurface.js";
import { envelope, type Weigher } from "./riderWeights.js";

/** Thigh with quadriceps and kneecap, shin with calf, Achilles taper towards the ankle. */
function legSection(
  segment: 0 | 1,
  t: number,
  angleRad: number,
  scale = 1,
): readonly [number, number] {
  const [across, along] =
    segment === 0
      ? muscle(
          lerp(0.08, 0.05, t),
          lerp(0.082, 0.046, t),
          0.14 * bump(t, 0.45, 0.5) + 0.22 * bump(t, 0.98, 0.1),
          0.06 * bump(t, 0.35, 0.45),
          angleRad,
        )
      : muscle(
          lerp(0.048, 0.03, t) + 0.006 * bump(t, 0.3, 0.3),
          lerp(0.046, 0.029, t),
          0.05 * bump(t, 0.05, 0.1),
          0.45 * bump(t, 0.28, 0.32),
          angleRad,
        );

  return [across * scale, along * scale];
}

export function addLeg(
  bucket: Readonly<SkinBucket>,
  leg: Readonly<LegPose>,
  bind: BoneSegments,
  side: 1 | -1,
): void {
  const names = bonesOfSide(side);
  const weights: Weigher = envelope(bind, ["Hips", names.upLeg, names.leg, names.foot]);
  const points = [extend(leg.hip, leg.knee, 0.07), leg.knee, leg.ankle] as const;
  const shorts = chain(points, [0, 0.42], 18);
  const skin = chain(points, [0.36, 1], 30);
  const sock = chain(points, [0.86, 1], 50);

  bucket.add(
    "kit",
    tube(
      shorts.path,
      (t, angle) => legSection(...shorts.at(t), angle, 1.04 + 0.012 * bump(t, 0.95, 0.06)),
      { forward: LEG_FRONT, segments: 22, uv: inBand(KIT_ATLAS.leg) },
    ),
    weights,
  );
  bucket.add(
    "skin",
    tube(skin.path, (t, angle) => legSection(...skin.at(t), angle), {
      forward: LEG_FRONT,
      segments: 18,
    }),
    weights,
    PLAIN_SKIN_UV,
  );
  bucket.add(
    "sock",
    tube(
      [...sock.path, add3(leg.ankle, [0, -1, 0], 0.035)],
      (t, angle) => legSection(1, Math.min(1, 0.86 + t * 0.14), angle, 1.07),
      { forward: LEG_FRONT, segments: 18 },
    ),
    weights,
  );
}
