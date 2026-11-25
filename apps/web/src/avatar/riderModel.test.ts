import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { bikeGeometry, type BikeGeometry, type Point3 } from "./bikeGeometry.js";
import { DEFAULT_WHEEL_SPEC, FRAME_SPECS } from "./bikeSpecs.js";
import { armPose, headPose, legPose, type RiderJoints } from "./pose.js";
import { RiderOnBike } from "./rider.js";
import { BONE_NAMES, boneIndex, bonesOfSide, type BoneName } from "./riderRig.js";

const WHEEL_CIRC_M = 2.105;

/** Moves a bind-pose point with a bone, exactly as the skinning shader does for weight 1. */
function follow(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rider owns its mutable Three skeleton, only inspected here.
  rider: RiderOnBike,
  bone: BoneName,
  point: Point3,
): THREE.Vector3 {
  rider.root.updateMatrixWorld(true);

  const index = boneIndex(bone);

  const matrix = new THREE.Matrix4().multiplyMatrices(
    rider.rig.bones[index]?.matrixWorld ?? new THREE.Matrix4(),
    rider.rig.skeleton.boneInverses[index] ?? new THREE.Matrix4(),
  );

  return new THREE.Vector3(...point).applyMatrix4(matrix);
}

function distance(a: Readonly<THREE.Vector3>, b: Point3): number {
  return a.distanceTo(new THREE.Vector3(...b));
}

/** Skinned positions of every vertex of the rider in model space. */
function skinnedPositions(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rider owns its mutable Three meshes, only inspected here.
  rider: RiderOnBike,
): THREE.Vector3[] {
  rider.root.updateMatrixWorld(true);

  const points: THREE.Vector3[] = [];

  for (const mesh of rider.meshes()) {
    const position = mesh.geometry.getAttribute("position");

    for (let vertex = 0; vertex < position.count; vertex += 1) {
      points.push(
        mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(position, vertex)),
      );
    }
  }

  return points;
}

/** Largest distance between a built vertex and its skinned position. */
function bindDeviationM(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rider owns its mutable Three meshes, only inspected here.
  rider: RiderOnBike,
): number {
  const skinned = skinnedPositions(rider);
  let index = 0;
  let worst = 0;

  for (const mesh of rider.meshes()) {
    const position = mesh.geometry.getAttribute("position");

    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const built = new THREE.Vector3().fromBufferAttribute(position, vertex);

      worst = Math.max(worst, built.distanceTo(skinned[index] ?? built));
      index += 1;
    }
  }

  return worst;
}

function namesOf(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three objects are mutable library objects, only their names are read.
  objects: readonly Readonly<THREE.Object3D>[],
): string[] {
  const names: string[] = [];

  for (const object of objects) names.push(object.name);

  return names;
}

/** Largest distance of cleats and grips from their IK targets after posing. */
function limbFitErrorM(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rider owns its mutable Three skeleton, only inspected here.
  rider: RiderOnBike,
  bind: Readonly<RiderJoints>,
  geometry: Readonly<BikeGeometry>,
): number {
  let worst = 0;

  for (const [side, leg, arm] of [
    [1, bind.legs[0], bind.arms[0]],
    [-1, bind.legs[1], bind.arms[1]],
  ] as const) {
    const names = bonesOfSide(side);
    const cleat = legPose(geometry, rider.crankRad, side).cleat;

    worst = Math.max(
      worst,
      distance(follow(rider, names.foot, leg.cleat), cleat),
      distance(follow(rider, names.hand, arm.grip), armPose(geometry, side).grip),
    );
  }

  return worst;
}

describe("rider skeleton", () => {
  it("uses at most 40 Mixamo-named bones under a single Hips root", () => {
    const rider = new RiderOnBike(WHEEL_CIRC_M);

    expect(rider.rig.bones.length).toBeLessThanOrEqual(40);
    expect(namesOf(rider.rig.bones)).toEqual([...BONE_NAMES]);
    expect(namesOf(rider.rig.root.children)).toEqual(["Hips"]);
  });

  it("starts in the bind pose: skinning leaves every vertex where it was built", () => {
    expect(bindDeviationM(new RiderOnBike(WHEEL_CIRC_M))).toBeLessThan(1e-5);
  });

  it("normalises up to four bone weights per vertex", () => {
    const rider = new RiderOnBike(WHEEL_CIRC_M);

    for (const mesh of rider.meshes()) {
      const weights = mesh.geometry.getAttribute("skinWeight");

      for (let vertex = 0; vertex < weights.count; vertex += 1) {
        const sum =
          weights.getX(vertex) + weights.getY(vertex) + weights.getZ(vertex) + weights.getW(vertex);

        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });
});

describe("rider fit on every frame", () => {
  it.each(FRAME_SPECS)("keeps cleats on the pedals and hands on the $key hoods", (frame) => {
    const rider = new RiderOnBike(WHEEL_CIRC_M);
    const bind = new RiderOnBike(WHEEL_CIRC_M).joints();

    rider.bike.setVariant(frame, DEFAULT_WHEEL_SPEC);

    const geometry = bikeGeometry(WHEEL_CIRC_M, frame, DEFAULT_WHEEL_SPEC);

    for (let step = 0; step < 12; step += 1) {
      rider.crankRad = (step / 12) * Math.PI * 2;
      rider.poseAt(rider.crankRad);

      expect(limbFitErrorM(rider, bind, geometry)).toBeLessThan(1e-6);
    }

    expect(distance(follow(rider, "Head", bind.head.base), headPose(geometry).base)).toBeLessThan(
      1e-6,
    );
  });

  it("keeps every skinned vertex finite and above the road through a pedal stroke", () => {
    const rider = new RiderOnBike(WHEEL_CIRC_M);

    for (let step = 0; step < 8; step += 1) {
      rider.poseAt((step / 8) * Math.PI * 2);

      for (const point of skinnedPositions(rider)) {
        expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
        expect(point.y).toBeGreaterThan(0.03);
      }
    }
  });
});
