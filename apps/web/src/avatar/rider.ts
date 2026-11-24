import * as THREE from "three";

import type { AvatarConfig } from "@voltonaut/shared";

import { disposeObject } from "../world/resources.js";
import type { FrameInput, RenderSystem } from "../world/scheduler.js";
import type { BikeGeometry } from "./bikeGeometry.js";
import { BikeModel } from "./bikeModel.js";
import { avatarLook } from "./look.js";
import { advanceCrankRad, wheelAngleRad } from "./motion.js";
import { placeTube, poseLegs, solveTwoBone, type Point3, type RiderLeg } from "./pose.js";

const TORSO_M = 0.58;
const TORSO_RAD = (38 * Math.PI) / 180;
const UPPER_ARM_M = 0.29;
const FOREARM_M = 0.3;

export interface RiderModel {
  readonly root: THREE.Group;
  crankRad: number;
  headingRad: number;
  update(frame: FrameInput): void;
  posePreview(): void;
  setLook(config: AvatarConfig): void;
}

interface RiderArm {
  readonly side: 1 | -1;
  readonly upper: THREE.Mesh;
  readonly lower: THREE.Mesh;
  readonly hand: THREE.Mesh;
}

function offset(point: Point3, dx: number, dy: number, z = point[2]): Point3 {
  return [point[0] + dx, point[1] + dy, z];
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

class Bicycle implements RiderModel {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  private readonly bike: BikeModel;
  private readonly legs: RiderLeg[] = [];
  private readonly arms: RiderArm[] = [];
  private readonly shoes: THREE.Mesh[] = [];
  private readonly glasses = new THREE.Group();
  private readonly tubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  private readonly jersey = new THREE.MeshStandardMaterial({ color: 0xec6b48, roughness: 0.85 });
  private readonly jerseyAccent = new THREE.MeshStandardMaterial({
    color: 0xf5ebca,
    roughness: 0.85,
  });
  private readonly jerseyAccentBand = new THREE.Mesh(this.tubeGeometry, this.jerseyAccent);
  private readonly bibs = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.7 });
  private readonly skin = new THREE.MeshStandardMaterial({ color: 0xc98d68, roughness: 0.9 });
  private readonly helmet = new THREE.MeshStandardMaterial({ color: 0xf5ebca, roughness: 0.65 });
  private readonly shoe = new THREE.MeshStandardMaterial({ color: 0xf5ebca, roughness: 0.7 });
  private readonly lens = new THREE.MeshStandardMaterial({
    color: 0x18272e,
    roughness: 0.15,
    metalness: 0.6,
  });
  private readonly torso: THREE.Mesh;
  private readonly neck: THREE.Mesh;
  private readonly head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), this.skin);
  private readonly helmetShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 18, 10),
    this.helmet,
  );
  private accentRadiusM = 0.152;
  crankRad = 0;
  headingRad = 0;
  private lastRideS: number | undefined;

  constructor(private readonly wheelCircM: number) {
    this.bike = new BikeModel(wheelCircM);
    this.model.add(this.bike.root);
    this.torso = this.tube(this.jersey);
    this.torso.name = "jersey-primary";
    this.neck = this.tube(this.skin);
    this.buildRider();
    this.poseBody();
    this.root.add(this.model);
  }

  private tube(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three materials are mutable library objects shared by the owned model.
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.tubeGeometry, material);

    mesh.castShadow = true;
    this.model.add(mesh);

    return mesh;
  }

  private buildRider(): void {
    this.jerseyAccentBand.name = "jersey-accent";
    this.jerseyAccentBand.castShadow = true;
    this.jerseyAccentBand.visible = false;
    this.model.add(this.jerseyAccentBand);

    for (const side of [1, -1] as const) {
      this.arms.push({
        side,
        upper: this.tube(this.jersey),
        lower: this.tube(this.skin),
        hand: this.tube(this.bibs),
      });
      this.legs.push({ side, thigh: this.tube(this.bibs), shin: this.tube(this.skin) });

      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.085), this.lens);
      lens.position.set(0.105, 0.015, side * 0.05);
      lens.rotation.y = side * 0.25;
      this.glasses.add(lens);

      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.17, 4, 10), this.shoe);
      shoe.name = side === 1 ? "shoe-right" : "shoe-left";
      shoe.geometry.rotateZ(Math.PI / 2);
      shoe.geometry.scale(1, 0.72, 0.95);
      shoe.castShadow = true;
      this.shoes.push(shoe);
      this.model.add(shoe);
    }

    this.head.castShadow = true;
    this.helmetShell.castShadow = true;
    this.helmetShell.scale.set(1.22, 0.7, 1);
    this.head.add(this.glasses);
    this.glasses.visible = false;
    this.model.add(this.head, this.helmetShell);
  }

  /** Places torso, head and arms for the current bike fit. */
  private poseBody(): void {
    const geometry = this.bike.geometry;
    const { pelvis, neck } = torsoPoints(geometry);
    const head = offset(neck, 0.13, 0.17);

    placeTube(this.torso, pelvis, neck, 0.15);
    placeTube(
      this.jerseyAccentBand,
      offset(pelvis, (neck[0] - pelvis[0]) * 0.3, (neck[1] - pelvis[1]) * 0.3),
      offset(pelvis, (neck[0] - pelvis[0]) * 0.56, (neck[1] - pelvis[1]) * 0.56),
      this.accentRadiusM,
    );
    placeTube(this.neck, offset(neck, -0.02, -0.02), offset(neck, 0.1, 0.13), 0.058);
    this.head.position.set(...head);
    this.helmetShell.position.set(head[0] - 0.02, head[1] + 0.075, 0);
    this.helmetShell.rotation.z = -0.25;

    for (const arm of this.arms) {
      const shoulder = offset(neck, -0.04, -0.035, arm.side * 0.165);

      const grip: Point3 = [
        geometry.hoodGrip[0],
        geometry.hoodGrip[1] + 0.012,
        arm.side * geometry.hoodGrip[2],
      ];

      const wrist = offset(grip, -0.035, 0.018);

      const elbow = solveTwoBone(shoulder, wrist, UPPER_ARM_M, FOREARM_M, [
        -0.35,
        -1,
        arm.side * 0.6,
      ]);

      placeTube(arm.upper, shoulder, elbow, 0.047);
      placeTube(arm.lower, elbow, wrist, 0.035);
      placeTube(arm.hand, wrist, offset(grip, 0.03, -0.006), 0.026);
    }
  }

  setLook(config: AvatarConfig): void {
    const look = avatarLook(config);

    if (this.bike.setVariant(look.frame, look.wheels)) this.poseBody();

    this.bike.setColors(config.bike.frameColor);
    this.jersey.color.set(config.rider.jerseyColors[0]);
    this.jerseyAccent.color.set(config.rider.jerseyColors[1]);
    this.jerseyAccent.roughness = look.jerseyAccentRoughness;
    this.jerseyAccentBand.visible = true;
    this.accentRadiusM = look.jerseyAccentRadiusM;
    this.jerseyAccentBand.scale.x = look.jerseyAccentRadiusM;
    this.jerseyAccentBand.scale.z = look.jerseyAccentRadiusM;
    this.skin.color.set(config.rider.skinTone);
    this.helmet.color.set(config.rider.helmetColor);
    this.shoe.color.setHex(look.shoeColor);
    this.glasses.visible = look.glassesVisible;
    poseLegs(this.legs, this.shoes, this.bike.geometry, this.crankRad);
  }

  posePreview(): void {
    this.crankRad = Math.PI / 2;
    this.bike.setMotion(this.crankRad, 0.6);
    poseLegs(this.legs, this.shoes, this.bike.geometry, this.crankRad);
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
    this.bike.setMotion(this.crankRad, wheelAngleRad(ride.distanceM, this.wheelCircM));
    poseLegs(this.legs, this.shoes, this.bike.geometry, this.crankRad);
  }
}

export interface RiderView {
  readonly system: RenderSystem;
  readonly position: () => { readonly x: number; readonly y: number; readonly z: number };
  readonly headingRad: () => number;
  readonly crankRad: () => number;
}

export function createRiderModel(wheelCircM: number): RiderModel {
  return new Bicycle(wheelCircM);
}

export function createRider(wheelCircM: number): RiderView {
  const bicycle = createRiderModel(wheelCircM);

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
