import * as THREE from "three";

import { pedalPoint, type BikeGeometry, type Point3 } from "./bikeGeometry.js";

export type { Point3 } from "./bikeGeometry.js";

export const THIGH_M = 0.45;
export const SHIN_M = 0.45;

// Long enough to keep a slight elbow bend on the longest-reach frame (aero).
export const UPPER_ARM_M = 0.31;
export const FOREARM_M = 0.31;

const TORSO_M = 0.58;
const TORSO_RAD = (38 * Math.PI) / 180;

/** Rounded racing back: how far the spine bows away from the straight pelvis → neck line. */
const BACK_BOW_M = 0.035;

/** Cleat and pedal body: the shoe sole sits this far above the pedal spindle axis. */
export const CLEAT_STACK_M = 0.014;

/** Ankle joint in the foot frame: behind and above the cleat. */
const ANKLE_BACK_M = 0.11;
const ANKLE_UP_M = 0.072;

/** Ball of the foot above the cleat; the toe bone runs forward from here. */
const BALL_UP_M = 0.02;
const TOE_M = 0.07;

function offset(point: Point3, dx: number, dy: number, z = point[2]): Point3 {
  return [point[0] + dx, point[1] + dy, z];
}

/**
 * Two-bone IK: returns the middle joint (knee/elbow) for a chain root → target with the given
 * bone lengths, bending towards `pole`. Unreachable targets are clamped to a nearly straight chain.
 */
export function solveTwoBone(
  root: Point3,
  target: Point3,
  upperM: number,
  lowerM: number,
  pole: Point3,
): Point3 {
  const origin = new THREE.Vector3(...root);
  const toTarget = new THREE.Vector3(...target).sub(origin);

  const reach = Math.min(
    Math.max(toTarget.length(), Math.abs(upperM - lowerM) + 1e-4),
    upperM + lowerM - 1e-4,
  );

  const direction = toTarget.normalize();
  const along = (upperM ** 2 - lowerM ** 2 + reach ** 2) / (2 * reach);
  const height = Math.sqrt(Math.max(0, upperM ** 2 - along ** 2));
  const bend = new THREE.Vector3(...pole);

  bend.addScaledVector(direction, -bend.dot(direction));

  if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(direction, -direction.x);

  bend.normalize();

  const joint = origin.addScaledVector(direction, along).addScaledVector(bend, height);

  return [joint.x, joint.y, joint.z];
}

/** Ankling: the toe points down a little more at the bottom of the stroke than at the top. */
export function footPitchRad(crankRad: number, side: 1 | -1): number {
  const angleRad = crankRad + (side === 1 ? 0 : Math.PI);

  return 0.22 + 0.1 * Math.sin(angleRad);
}

/** Point in the pitched foot frame: `forwardM` along the sole, `upM` normal to it. */
export function footPoint(cleat: Point3, pitchRad: number, forwardM: number, upM: number): Point3 {
  const cos = Math.cos(pitchRad);
  const sin = Math.sin(pitchRad);

  return [cleat[0] + cos * forwardM + sin * upM, cleat[1] - sin * forwardM + cos * upM, cleat[2]];
}

export interface LegPose {
  readonly hip: Point3;
  readonly knee: Point3;
  readonly ankle: Point3;
  /** Ball of the foot (foot bone end, toe bone start). */
  readonly ball: Point3;
  readonly toe: Point3;
  readonly pedal: Point3;
  /** Sole contact point on the pedal; the shoe is built around it. */
  readonly cleat: Point3;
  readonly footPitchRad: number;
}

export function legPose(geometry: Readonly<BikeGeometry>, crankRad: number, side: 1 | -1): LegPose {
  const pedal = pedalPoint(geometry, crankRad, side);
  const pitch = footPitchRad(crankRad, side);
  const hip: Point3 = [geometry.hip[0], geometry.hip[1], side * geometry.hip[2]];
  const cleat: Point3 = [pedal[0], pedal[1] + CLEAT_STACK_M, pedal[2] - side * 0.004];
  const ankle = footPoint(cleat, pitch, -ANKLE_BACK_M, ANKLE_UP_M);
  const kneeAnkle: Point3 = [ankle[0], ankle[1], side * 0.105];

  return {
    hip,
    knee: solveTwoBone(hip, kneeAnkle, THIGH_M, SHIN_M, [1, 0.25, 0]),
    ankle: kneeAnkle,
    ball: footPoint(cleat, pitch, 0, BALL_UP_M),
    toe: footPoint(cleat, pitch, TOE_M, BALL_UP_M * 0.6),
    pedal,
    cleat,
    footPitchRad: pitch,
  };
}

/** Upper-body anchor points derived from the bike fit (saddle and hoods). */
export interface TorsoPoints {
  readonly pelvis: Point3;
  readonly neck: Point3;
}

export function torsoPoints(geometry: Readonly<BikeGeometry>): TorsoPoints {
  const pelvis: Point3 = [geometry.hip[0] - 0.02, geometry.hip[1] + 0.03, 0];

  return {
    pelvis,
    neck: offset(pelvis, Math.cos(TORSO_RAD) * TORSO_M, Math.sin(TORSO_RAD) * TORSO_M),
  };
}

/** Point on the bowed spine between pelvis (t = 0) and neck base (t = 1). */
export function spinePoint(torso: Readonly<TorsoPoints>, t: number): Point3 {
  const { pelvis, neck } = torso;
  const dx = neck[0] - pelvis[0];
  const dy = neck[1] - pelvis[1];
  const length = Math.hypot(dx, dy);
  // Away from the chest: the back side of the torso, perpendicular to the spine line.
  const bow = BACK_BOW_M * Math.sin(Math.PI * t);

  return [pelvis[0] + dx * t - (dy / length) * bow, pelvis[1] + dy * t + (dx / length) * bow, 0];
}

/** Arm chain from the shoulder to the hand resting on the hood grip of one side. */
export interface ArmPose {
  readonly clavicle: Point3;
  readonly shoulder: Point3;
  readonly elbow: Point3;
  readonly wrist: Point3;
  readonly grip: Point3;
}

export function armPose(geometry: Readonly<BikeGeometry>, side: 1 | -1): ArmPose {
  const { neck } = torsoPoints(geometry);
  const shoulder = offset(neck, -0.04, -0.035, side * 0.165);

  const grip: Point3 = [
    geometry.hoodGrip[0],
    geometry.hoodGrip[1] + 0.012,
    side * geometry.hoodGrip[2],
  ];

  const wrist = offset(grip, -0.035, 0.018);
  const elbow = solveTwoBone(shoulder, wrist, UPPER_ARM_M, FOREARM_M, [-0.35, -1, side * 0.6]);

  return { clavicle: offset(neck, -0.035, -0.045, side * 0.035), shoulder, elbow, wrist, grip };
}

/** Head pitch: the rider looks up the road although the torso leans forward. */
const HEAD_AXIS: Point3 = [0.27, 0.96, 0];

export interface HeadPose {
  /** Top of the neck, origin of the head bone. */
  readonly base: Point3;
  /** Along the head's up axis, end of the head bone. */
  readonly top: Point3;
}

export function headPose(geometry: Readonly<BikeGeometry>): HeadPose {
  const { neck } = torsoPoints(geometry);
  const base = offset(neck, 0.062, 0.068);

  return { base, top: [base[0] + HEAD_AXIS[0] * 0.2, base[1] + HEAD_AXIS[1] * 0.2, 0] };
}

/** Every joint of the rider for one bike fit and crank angle. */
export interface RiderJoints {
  readonly spine: readonly [Point3, Point3, Point3, Point3, Point3];
  readonly head: HeadPose;
  readonly arms: readonly [ArmPose, ArmPose];
  readonly legs: readonly [LegPose, LegPose];
}

export function riderJoints(geometry: Readonly<BikeGeometry>, crankRad: number): RiderJoints {
  const torso = torsoPoints(geometry);

  return {
    spine: [
      torso.pelvis,
      spinePoint(torso, 0.25),
      spinePoint(torso, 0.5),
      spinePoint(torso, 0.75),
      torso.neck,
    ],
    head: headPose(geometry),
    arms: [armPose(geometry, 1), armPose(geometry, -1)],
    legs: [legPose(geometry, crankRad, 1), legPose(geometry, crankRad, -1)],
  };
}
