import { describe, expect, it } from "vitest";

import { bikeGeometry, type Point3 } from "./bikeGeometry.js";
import { DEFAULT_WHEEL_SPEC, FRAME_SPECS } from "./bikeSpecs.js";
import {
  armPose,
  FOREARM_M,
  legPose,
  SHIN_M,
  solveTwoBone,
  THIGH_M,
  torsoPoints,
  UPPER_ARM_M,
} from "./pose.js";

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe("two-bone IK", () => {
  it("keeps bone lengths and bends towards the pole", () => {
    const joint = solveTwoBone([0, 1, 0], [0.2, 0.2, 0], 0.45, 0.45, [1, 0, 0]);

    expect(distance(joint, [0, 1, 0])).toBeCloseTo(0.45, 9);
    expect(distance(joint, [0.2, 0.2, 0])).toBeCloseTo(0.45, 9);
    expect(joint[0]).toBeGreaterThan(0.1);
  });

  it("clamps unreachable targets to a straight chain towards the target", () => {
    const joint = solveTwoBone([0, 0, 0], [0, -2, 0], 0.4, 0.5, [1, 0, 0]);

    expect(joint[1]).toBeCloseTo(-0.4, 3);
    expect(Math.abs(joint[0])).toBeLessThan(0.01);
  });
});

const SIDES = [1, -1] as const;

describe("pedalling leg pose", () => {
  it.each(FRAME_SPECS)(
    "reaches every pedal position on the $key frame with a bent knee",
    (frame) => {
      const geometry = bikeGeometry(2.105, frame, DEFAULT_WHEEL_SPEC);

      for (let step = 0; step < 24; step += 1) {
        for (const side of SIDES) {
          const pose = legPose(geometry, (step / 24) * Math.PI * 2, side);

          expect(distance(pose.hip, pose.knee)).toBeCloseTo(THIGH_M, 6);
          expect(distance(pose.knee, pose.ankle)).toBeCloseTo(SHIN_M, 6);
          expect(distance(pose.hip, pose.ankle)).toBeLessThan(THIGH_M + SHIN_M - 0.01);
          expect(pose.knee[0]).toBeGreaterThan(pose.hip[0]);
        }
      }
    },
  );
});

describe("rider fit", () => {
  it.each(FRAME_SPECS)(
    "puts the hands on the $key hoods with a bent elbow and the hip over the saddle",
    (frame) => {
      const geometry = bikeGeometry(2.105, frame, DEFAULT_WHEEL_SPEC);

      for (const side of SIDES) {
        const arm = armPose(geometry, side);

        expect(distance(arm.shoulder, arm.elbow)).toBeCloseTo(UPPER_ARM_M, 6);
        expect(distance(arm.elbow, arm.wrist)).toBeCloseTo(FOREARM_M, 6);
        expect(distance(arm.shoulder, arm.wrist)).toBeLessThan(UPPER_ARM_M + FOREARM_M - 0.02);
        expect(arm.grip[0]).toBeCloseTo(geometry.hoodGrip[0], 6);
        expect(arm.grip[2]).toBeCloseTo(side * geometry.hoodGrip[2], 6);
      }

      expect(Math.abs(torsoPoints(geometry).pelvis[0] - geometry.hip[0])).toBeLessThan(0.05);
    },
  );
});
