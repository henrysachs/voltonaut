import { describe, expect, it } from "vitest";

import { bikeGeometry, type Point3 } from "./bikeGeometry.js";
import { DEFAULT_WHEEL_SPEC, FRAME_SPECS } from "./bikeSpecs.js";
import { legPose, SHIN_M, solveTwoBone, THIGH_M } from "./pose.js";
import { armPose, FOREARM_M, torsoPoints, UPPER_ARM_M } from "./rider.js";

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

function elbowAngleDeg(shoulder: Point3, elbow: Point3, wrist: Point3): number {
  const upper = distance(shoulder, elbow);
  const lower = distance(elbow, wrist);
  const span = distance(shoulder, wrist);

  return (Math.acos((upper ** 2 + lower ** 2 - span ** 2) / (2 * upper * lower)) * 180) / Math.PI;
}

describe("rider fit", () => {
  it.each(FRAME_SPECS)(
    "puts the hands on the $key hoods with a bent elbow and the hip over the saddle",
    (frame) => {
      const geometry = bikeGeometry(2.105, frame, DEFAULT_WHEEL_SPEC);
      const { pelvis } = torsoPoints(geometry);

      for (const side of SIDES) {
        const arm = armPose(geometry, side);

        const hood: Point3 = [
          geometry.hoodGrip[0],
          geometry.hoodGrip[1],
          side * geometry.hoodGrip[2],
        ];

        const along = (arm.elbow[0] - arm.shoulder[0]) / (arm.wrist[0] - arm.shoulder[0]);

        // Hoods of different frames sit only 1–3 cm apart, so pin the hand to this frame's hood
        // fore-aft and across; the palm rests a fixed 1.2 cm above it.
        expect(Math.hypot(arm.grip[0] - hood[0], arm.grip[2] - hood[2])).toBeLessThan(0.005);
        expect(arm.grip[1] - hood[1]).toBeGreaterThan(0);
        expect(arm.grip[1] - hood[1]).toBeLessThan(0.03);
        expect(distance(arm.shoulder, arm.elbow)).toBeCloseTo(UPPER_ARM_M, 6);
        expect(distance(arm.elbow, arm.wrist)).toBeCloseTo(FOREARM_M, 6);
        // A locked arm (≈ 180°) means the hood is out of reach; a sharp bend means a cramped fit.
        expect(elbowAngleDeg(arm.shoulder, arm.elbow, arm.wrist)).toBeGreaterThan(120);
        expect(elbowAngleDeg(arm.shoulder, arm.elbow, arm.wrist)).toBeLessThan(165);
        // The elbow sags below the shoulder→wrist line and flares out, never up into the torso.
        expect(arm.elbow[1]).toBeLessThan(
          arm.shoulder[1] + along * (arm.wrist[1] - arm.shoulder[1]),
        );
        expect(side * arm.elbow[2]).toBeGreaterThan(side * arm.shoulder[2]);
      }

      expect(Math.abs(pelvis[0] - geometry.saddleTop[0])).toBeLessThan(0.05);
    },
  );
});
