import { add3, lerp, mix, smoothPath } from "./bikeSweep.js";
import type { RiderJoints } from "./pose.js";
import { PLAIN_SKIN_UV } from "./riderAtlas.js";
import { addArm, addHand } from "./riderArms.js";
import { addLeg } from "./riderLegs.js";
import { bump, muscle } from "./riderMuscle.js";
import type { BoneSegments } from "./riderRig.js";
import type { SkinBucket } from "./riderSkin.js";
import { tube, type TubeSection } from "./riderSurface.js";
import { envelope } from "./riderWeights.js";

const neckSection: TubeSection = (t, angle) =>
  muscle(lerp(0.062, 0.05, t), lerp(0.062, 0.05, t), 0.06 * bump(t, 0.6, 0.4), 0.05, angle);

/** Neck, arms with sleeves, gloved hands and legs with bib shorts and socks. */
export function addLimbs(
  bucket: Readonly<SkinBucket>,
  joints: Readonly<RiderJoints>,
  bind: BoneSegments,
): void {
  const neck = joints.spine[4];
  const head = joints.head.base;

  bucket.add(
    "skin",
    tube(
      smoothPath(
        [add3(neck, [-0.05, -0.04, 0]), neck, mix(neck, head, 0.6), add3(head, [0.01, 0.045, 0])],
        8,
      ),
      neckSection,
      { segments: 16 },
    ),
    envelope(bind, ["Spine2", "Neck", "Head"]),
    PLAIN_SKIN_UV,
  );

  for (const [index, side] of ([1, -1] as const).entries()) {
    addArm(bucket, joints.arms[index] ?? joints.arms[0], bind, side);
    addHand(bucket, joints.arms[index] ?? joints.arms[0], bind, side);
    addLeg(bucket, joints.legs[index] ?? joints.legs[0], bind, side);
  }
}
