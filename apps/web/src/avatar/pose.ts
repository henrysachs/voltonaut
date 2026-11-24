import * as THREE from "three";

import { pedalPoint, type BikeGeometry, type Point3 } from "./bikeGeometry.js";

export type { Point3 } from "./bikeGeometry.js";

export interface RiderLeg {
  readonly side: 1 | -1;
  readonly thigh: THREE.Mesh;
  readonly shin: THREE.Mesh;
}

export const THIGH_M = 0.45;
export const SHIN_M = 0.45;
const FOOT_M = 0.1;

export function placeTube(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Posing updates the owned Three mesh transform.
  mesh: Readonly<THREE.Mesh>,
  start: Point3,
  end: Point3,
  radiusM: number,
): void {
  const from = new THREE.Vector3(...start);
  const direction = new THREE.Vector3(...end).sub(from);

  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.scale.set(radiusM, direction.length(), radiusM);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
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

export interface LegPose {
  readonly hip: Point3;
  readonly knee: Point3;
  readonly ankle: Point3;
  readonly pedal: Point3;
  readonly footPitchRad: number;
}

export function legPose(geometry: Readonly<BikeGeometry>, crankRad: number, side: 1 | -1): LegPose {
  const pedal = pedalPoint(geometry, crankRad, side);
  const pitch = footPitchRad(crankRad, side);
  const hip: Point3 = [geometry.hip[0], geometry.hip[1], side * geometry.hip[2]];

  const ankle: Point3 = [
    pedal[0] - Math.cos(pitch) * FOOT_M,
    pedal[1] + Math.sin(pitch) * FOOT_M + 0.045,
    side * 0.108,
  ];

  return {
    hip,
    knee: solveTwoBone(hip, ankle, THIGH_M, SHIN_M, [1, 0.25, 0]),
    ankle,
    pedal,
    footPitchRad: pitch,
  };
}

export function poseLegs(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Posing updates the owned leg meshes.
  legs: readonly Readonly<RiderLeg>[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Posing updates the owned shoe meshes.
  shoes: readonly Readonly<THREE.Mesh>[],
  geometry: Readonly<BikeGeometry>,
  crankRad: number,
): void {
  for (const [index, leg] of legs.entries()) {
    const pose = legPose(geometry, crankRad, leg.side);

    placeTube(leg.thigh, pose.hip, pose.knee, 0.072);
    placeTube(leg.shin, pose.knee, pose.ankle, 0.044);

    const shoe = shoes[index];

    if (shoe !== undefined) {
      shoe.position.set(
        pose.pedal[0] - Math.cos(pose.footPitchRad) * 0.03,
        pose.pedal[1] + Math.sin(pose.footPitchRad) * 0.03 + 0.03,
        pose.pedal[2] - leg.side * 0.004,
      );
      shoe.rotation.set(0, 0, -pose.footPitchRad);
    }
  }
}
