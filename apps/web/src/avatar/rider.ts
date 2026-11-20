import * as THREE from "three";

import { disposeObject } from "../world/resources.js";
import type { FrameInput, RenderSystem } from "../world/scheduler.js";
import { advanceCrankRad, wheelAngleRad } from "./motion.js";

type Point3 = readonly [number, number, number];

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Posing updates the owned Three mesh transform.
function placeTube(mesh: Readonly<THREE.Mesh>, start: Point3, end: Point3, radiusM: number): void {
  const from = new THREE.Vector3(...start);
  const direction = new THREE.Vector3(...end).sub(from);

  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.scale.set(radiusM, direction.length(), radiusM);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

interface Leg {
  readonly side: number;
  readonly thigh: THREE.Mesh;
  readonly shin: THREE.Mesh;
}

const BRACKET: Point3 = [-0.08, 0.43, 0];
const SEAT: Point3 = [-0.3, 0.96, 0];
const HEAD_TUBE: Point3 = [0.39, 0.92, 0];

class Bicycle {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly crank = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly tubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  private readonly frameMaterial = new THREE.MeshStandardMaterial({
    color: 0xf0a83b,
    metalness: 0.45,
    roughness: 0.3,
  });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x18272e, roughness: 0.65 });
  private readonly metal = new THREE.MeshStandardMaterial({
    color: 0xd3dadb,
    metalness: 0.8,
    roughness: 0.25,
  });
  private readonly jersey = new THREE.MeshStandardMaterial({ color: 0xec6b48, roughness: 0.85 });
  private readonly skin = new THREE.MeshStandardMaterial({ color: 0xc98d68, roughness: 0.9 });
  private readonly helmet = new THREE.MeshStandardMaterial({ color: 0xf5ebca, roughness: 0.65 });
  crankRad = 0;
  headingRad = 0;
  private lastRideS: number | undefined;

  constructor(private readonly wheelCircM: number) {
    this.buildFrame();
    this.buildWheels();
    this.buildRider();
    this.root.add(this.model);
  }

  private tube(
    start: Point3,
    end: Point3,
    radiusM: number,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three materials are mutable library objects shared by the owned model.
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.tubeGeometry, material);

    placeTube(mesh, start, end, radiusM);
    mesh.castShadow = true;
    this.model.add(mesh);

    return mesh;
  }

  private buildFrame(): void {
    const radiusM = this.wheelCircM / (2 * Math.PI);
    const rear: Point3 = [-0.56, radiusM, 0];
    const front: Point3 = [0.56, radiusM, 0];

    for (const [start, end] of [
      [rear, BRACKET],
      [BRACKET, SEAT],
      [SEAT, rear],
      [SEAT, HEAD_TUBE],
      [HEAD_TUBE, BRACKET],
      [HEAD_TUBE, front],
    ] satisfies [Point3, Point3][]) {
      this.tube(start, end, 0.025, this.frameMaterial);
    }

    this.tube(SEAT, [-0.3, 1.03, 0], 0.022, this.metal);
    this.tube([-0.45, 1.04, 0], [-0.18, 1.04, 0], 0.045, this.dark);
    this.tube(HEAD_TUBE, [0.5, 1.05, 0], 0.022, this.metal);
    this.tube([0.5, 1.05, -0.23], [0.5, 1.05, 0.23], 0.025, this.dark);
    this.crank.position.set(...BRACKET);
    this.crank.position.z = 0.16;
    this.crank.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), this.metal));
    this.model.add(this.crank);
  }

  private buildWheels(): void {
    const radiusM = this.wheelCircM / (2 * Math.PI);

    for (const x of [-0.56, 0.56]) {
      const wheel = new THREE.Group();

      const tire = new THREE.Mesh(
        new THREE.TorusGeometry(radiusM - 0.022, 0.022, 8, 32),
        this.dark,
      );

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radiusM - 0.045, 0.012, 6, 32),
        this.metal,
      );

      tire.castShadow = true;
      wheel.add(tire, rim);

      for (let spoke = 0; spoke < 8; spoke += 1) {
        const angleRad = (spoke / 8) * Math.PI * 2;
        const mesh = new THREE.Mesh(this.tubeGeometry, this.metal);

        placeTube(
          mesh,
          [0, 0, 0],
          [Math.cos(angleRad) * (radiusM - 0.05), Math.sin(angleRad) * (radiusM - 0.05), 0],
          0.004,
        );
        wheel.add(mesh);
      }

      wheel.position.set(x, radiusM, 0);
      this.model.add(wheel);
      this.wheels.push(wheel);
    }
  }

  private buildRider(): void {
    this.tube([-0.3, 1.1, 0], [0.16, 1.46, 0], 0.15, this.jersey);
    this.tube([0.16, 1.46, 0], [0.26, 1.59, 0], 0.06, this.skin);

    for (const side of [-1, 1]) {
      this.tube([0.12, 1.43, side * 0.16], [0.36, 1.18, side * 0.22], 0.045, this.jersey);
      this.tube([0.36, 1.18, side * 0.22], [0.5, 1.05, side * 0.21], 0.035, this.skin);
      this.legs.push({
        side,
        thigh: this.tube([-0.3, 1.12, side * 0.12], [0.1, 0.8, side * 0.14], 0.075, this.dark),
        shin: this.tube([0.1, 0.8, side * 0.14], [0, 0.43, side * 0.14], 0.045, this.skin),
      });
    }

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), this.skin);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), this.helmet);

    head.position.set(0.29, 1.64, 0);
    helmet.position.set(0.27, 1.72, 0);
    helmet.scale.set(1.2, 0.65, 1);
    head.castShadow = true;
    helmet.castShadow = true;
    this.model.add(head, helmet);
  }

  update(frame: FrameInput): void {
    const { ride } = frame;
    const elapsedS = this.lastRideS === undefined ? 0 : ride.tS - this.lastRideS;

    this.lastRideS = ride.tS;
    this.crankRad = advanceCrankRad(this.crankRad, ride.cadenceRpm, elapsedS);
    this.headingRad = ride.headingRad;
    this.root.position.set(ride.worldPos.x, ride.worldPos.y + 0.04, ride.worldPos.z);
    this.root.rotation.y = -ride.headingRad;
    this.model.rotation.z = Math.atan(ride.gradePct / 100);
    this.crank.rotation.z = -this.crankRad;

    for (const wheel of this.wheels) {
      wheel.rotation.z = -wheelAngleRad(ride.distanceM, this.wheelCircM);
    }

    for (const leg of this.legs) {
      const angleRad = this.crankRad + (leg.side === 1 ? 0 : Math.PI);

      const pedal: Point3 = [
        BRACKET[0] + Math.cos(angleRad) * 0.17,
        BRACKET[1] - Math.sin(angleRad) * 0.17,
        leg.side * 0.14,
      ];

      const knee: Point3 = [
        0.12 + Math.cos(angleRad) * 0.07,
        0.82 - Math.sin(angleRad) * 0.09,
        leg.side * 0.14,
      ];

      placeTube(leg.thigh, [-0.3, 1.12, leg.side * 0.12], knee, 0.075);
      placeTube(leg.shin, knee, pedal, 0.045);
    }
  }
}

export interface RiderView {
  readonly system: RenderSystem;
  readonly position: () => { readonly x: number; readonly y: number; readonly z: number };
  readonly headingRad: () => number;
  readonly crankRad: () => number;
}

export function createRider(wheelCircM: number): RiderView {
  const bicycle = new Bicycle(wheelCircM);

  return {
    position: () => ({
      x: bicycle.root.position.x,
      y: bicycle.root.position.y,
      z: bicycle.root.position.z,
    }),
    headingRad: () => bicycle.headingRad,
    crankRad: () => bicycle.crankRad,
    system: {
      id: "riders",
      order: 40,
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rider system installs its model in the owned Three scene.
      init(context) {
        context.scene.add(bicycle.root);
      },
      update(frame) {
        bicycle.update(frame);
      },
      setQuality() {},
      dispose() {
        disposeObject(bicycle.root);
      },
    },
  };
}
