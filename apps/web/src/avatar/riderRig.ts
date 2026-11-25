import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import type { ArmPose, LegPose, RiderJoints } from "./pose.js";
import { vector } from "./bikeSweep.js";

/**
 * Humanoid skeleton with Mixamo-compatible bone names (docs/05), so a later skinned GLB rider
 * (henrysachs/voltonaut#63) can reuse the procedural IK. Bones are posed directly from the IK joints.
 */
export const BONE_NAMES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

const PARENT: Readonly<Record<BoneName, BoneName | undefined>> = {
  Hips: undefined,
  Spine: "Hips",
  Spine1: "Spine",
  Spine2: "Spine1",
  Neck: "Spine2",
  Head: "Neck",
  RightShoulder: "Spine2",
  RightArm: "RightShoulder",
  RightForeArm: "RightArm",
  RightHand: "RightForeArm",
  LeftShoulder: "Spine2",
  LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm",
  LeftHand: "LeftForeArm",
  RightUpLeg: "Hips",
  RightLeg: "RightUpLeg",
  RightFoot: "RightLeg",
  RightToeBase: "RightFoot",
  LeftUpLeg: "Hips",
  LeftLeg: "LeftUpLeg",
  LeftFoot: "LeftLeg",
  LeftToeBase: "LeftFoot",
};

export function boneIndex(name: BoneName): number {
  return BONE_NAMES.indexOf(name);
}

/** Bone from its joint (`head`) to the next joint (`tail`); `twist` fixes the roll around it. */
export interface BoneSegment {
  readonly head: Point3;
  readonly tail: Point3;
  readonly twist: Point3;
}

const LATERAL: Point3 = [0, 0, 1];
const FORWARD: Point3 = [1, 0, 0];

function sideNames(side: 1 | -1): {
  readonly shoulder: BoneName;
  readonly arm: BoneName;
  readonly foreArm: BoneName;
  readonly hand: BoneName;
  readonly upLeg: BoneName;
  readonly leg: BoneName;
  readonly foot: BoneName;
  readonly toe: BoneName;
} {
  return side === 1
    ? {
        shoulder: "RightShoulder",
        arm: "RightArm",
        foreArm: "RightForeArm",
        hand: "RightHand",
        upLeg: "RightUpLeg",
        leg: "RightLeg",
        foot: "RightFoot",
        toe: "RightToeBase",
      }
    : {
        shoulder: "LeftShoulder",
        arm: "LeftArm",
        foreArm: "LeftForeArm",
        hand: "LeftHand",
        upLeg: "LeftUpLeg",
        leg: "LeftLeg",
        foot: "LeftFoot",
        toe: "LeftToeBase",
      };
}

export const SIDE_BONES = { right: sideNames(1), left: sideNames(-1) } as const;

export function bonesOfSide(side: 1 | -1): ReturnType<typeof sideNames> {
  return side === 1 ? SIDE_BONES.right : SIDE_BONES.left;
}

function bone(head: Point3, tail: Point3, twist: Point3 = LATERAL): BoneSegment {
  return { head, tail, twist };
}

interface LimbSegments {
  readonly shoulder: BoneSegment;
  readonly arm: BoneSegment;
  readonly foreArm: BoneSegment;
  readonly hand: BoneSegment;
  readonly upLeg: BoneSegment;
  readonly leg: BoneSegment;
  readonly foot: BoneSegment;
  readonly toe: BoneSegment;
}

function limbSegments(arm: Readonly<ArmPose>, leg: Readonly<LegPose>): LimbSegments {
  return {
    shoulder: bone(arm.clavicle, arm.shoulder, FORWARD),
    arm: bone(arm.shoulder, arm.elbow),
    foreArm: bone(arm.elbow, arm.wrist),
    hand: bone(arm.wrist, arm.grip),
    upLeg: bone(leg.hip, leg.knee),
    leg: bone(leg.knee, leg.ankle),
    foot: bone(leg.ankle, leg.ball),
    toe: bone(leg.ball, leg.toe),
  };
}

/** Bone segments of every bone for a set of joints. */
export function boneSegments(joints: Readonly<RiderJoints>): Record<BoneName, BoneSegment> {
  const [pelvis, spine1, spine2, spine3, neck] = joints.spine;
  const right = limbSegments(joints.arms[0], joints.legs[0]);
  const left = limbSegments(joints.arms[1], joints.legs[1]);

  return {
    Hips: bone(pelvis, spine1),
    Spine: bone(spine1, spine2),
    Spine1: bone(spine2, spine3),
    Spine2: bone(spine3, neck),
    Neck: bone(neck, joints.head.base),
    Head: bone(joints.head.base, joints.head.top),
    RightShoulder: right.shoulder,
    RightArm: right.arm,
    RightForeArm: right.foreArm,
    RightHand: right.hand,
    LeftShoulder: left.shoulder,
    LeftArm: left.arm,
    LeftForeArm: left.foreArm,
    LeftHand: left.hand,
    RightUpLeg: right.upLeg,
    RightLeg: right.leg,
    RightFoot: right.foot,
    RightToeBase: right.toe,
    LeftUpLeg: left.upLeg,
    LeftLeg: left.leg,
    LeftFoot: left.foot,
    LeftToeBase: left.toe,
  };
}

/** Bind or current segments of every bone. */
export type BoneSegments = Readonly<Record<BoneName, BoneSegment>>;

/** Model-space transform of a bone: origin at the joint, +Y towards the tail, +Z towards `twist`. */
export function boneMatrix(segment: Readonly<BoneSegment>): THREE.Matrix4 {
  const y = vector(segment.tail).sub(vector(segment.head)).normalize();
  const z = vector(segment.twist);

  z.addScaledVector(y, -z.dot(y));

  if (z.lengthSq() < 1e-8) z.set(1, 0, 0).addScaledVector(y, -y.x);

  z.normalize();

  const x = new THREE.Vector3().crossVectors(y, z);

  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(vector(segment.head));
}

/** Skeleton whose bones are placed from IK joints every frame. */
export class RiderRig {
  readonly root = new THREE.Group();
  readonly bones: readonly THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  private readonly bindValue: Record<BoneName, BoneSegment>;

  constructor(bind: Readonly<RiderJoints>) {
    this.root.name = "rider-armature";
    this.bindValue = boneSegments(bind);

    const bones = BONE_NAMES.map((name) => {
      const created = new THREE.Bone();

      created.name = name;

      return created;
    });

    for (const [index, name] of BONE_NAMES.entries()) {
      const parent = PARENT[name];
      const child = bones[index];

      if (child === undefined) continue;

      (parent === undefined ? this.root : bones[boneIndex(parent)])?.add(child);
    }

    this.bones = bones;

    const inverses = BONE_NAMES.map((name) => boneMatrix(this.bindValue[name]).invert());

    this.skeleton = new THREE.Skeleton(bones, inverses);
    this.pose(bind);
  }

  /** Bone segments of the bind pose that the skinned geometry was built in. */
  get bind(): Readonly<Record<BoneName, BoneSegment>> {
    return this.bindValue;
  }

  /** Places every bone from the joints; local transforms are derived from model-space ones. */
  pose(joints: Readonly<RiderJoints>): void {
    const segments = boneSegments(joints);
    const world = BONE_NAMES.map((name) => boneMatrix(segments[name]));
    const local = new THREE.Matrix4();

    for (const [index, name] of BONE_NAMES.entries()) {
      const parent = PARENT[name];
      const target = this.bones[index];
      const matrix = world[index];

      if (target === undefined || matrix === undefined) continue;

      const parentMatrix = parent === undefined ? undefined : world[boneIndex(parent)];

      local.copy(matrix);

      if (parentMatrix !== undefined) local.premultiply(parentMatrix.clone().invert());

      local.decompose(target.position, target.quaternion, target.scale);
    }
  }

  dispose(): void {
    this.skeleton.dispose();
  }
}
