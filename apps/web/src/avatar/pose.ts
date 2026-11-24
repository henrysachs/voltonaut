import * as THREE from "three";

export type Point3 = readonly [number, number, number];

export interface RiderLeg {
  readonly side: number;
  readonly thigh: THREE.Mesh;
  readonly shin: THREE.Mesh;
}

export const RIDER_BRACKET: Point3 = [-0.08, 0.43, 0];

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

export function poseLegs(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Posing updates the owned leg meshes.
  legs: readonly Readonly<RiderLeg>[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Posing updates the owned shoe meshes.
  shoes: readonly Readonly<THREE.Mesh>[],
  crankRad: number,
): void {
  for (const [index, leg] of legs.entries()) {
    const angleRad = crankRad + (leg.side === 1 ? 0 : Math.PI);

    const pedal: Point3 = [
      RIDER_BRACKET[0] + Math.cos(angleRad) * 0.17,
      RIDER_BRACKET[1] - Math.sin(angleRad) * 0.17,
      leg.side * 0.14,
    ];

    const knee: Point3 = [
      0.12 + Math.cos(angleRad) * 0.07,
      0.82 - Math.sin(angleRad) * 0.09,
      leg.side * 0.14,
    ];

    placeTube(leg.thigh, [-0.3, 1.12, leg.side * 0.12], knee, 0.075);
    placeTube(leg.shin, knee, pedal, 0.045);

    const shoe = shoes[index];

    if (shoe !== undefined) {
      shoe.position.set(pedal[0] + 0.035, pedal[1] + 0.025, pedal[2]);
      shoe.rotation.z = -0.15;
    }
  }
}
