import * as THREE from "three";

import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { AvatarConfigSchema, type AvatarConfig } from "@voltonaut/shared";

import { disposeObject } from "../world/resources.js";
import type { FrameInput, RenderSystem } from "../world/scheduler.js";
import { BikeModel } from "./bikeModel.js";
import { avatarLook } from "./look.js";
import { advanceCrankRad, wheelAngleRad } from "./motion.js";
import { riderJoints, type RiderJoints } from "./pose.js";
import { RiderBody } from "./riderBody.js";

export interface RiderModel {
  readonly root: THREE.Group;
  crankRad: number;
  headingRad: number;
  update(frame: FrameInput): void;
  posePreview(): void;
  dispose(): void;
  setLook(config: AvatarConfig): void;
}

/** Crank angle of the bind pose the skinned geometry is built in (right pedal forward). */
const BIND_CRANK_RAD = 0;

/**
 * Procedural rider on the procedural bike: one skinned mesh per material on a 22-bone skeleton,
 * posed every frame by IK from the bike fit and crank angle.
 */
export class RiderOnBike implements RiderModel {
  readonly root = new THREE.Group();
  readonly model = new THREE.Group();
  readonly bike: BikeModel;
  crankRad = 0;
  headingRad = 0;
  private wheelRad = 0;
  private lastRideS: number | undefined;
  private bodyValue: RiderBody | undefined;

  /**
   * `deferBody` leaves the rider body out of the first frame: the ride scene shows world and bike
   * first and builds the skinned rider (geometry, textures, shaders) on the next update.
   */
  constructor(
    private readonly wheelCircM: number,
    private deferBody = false,
  ) {
    this.root.name = "rider-root";
    this.bike = new BikeModel(wheelCircM);
    this.model.add(this.bike.root);
    this.root.add(this.model);

    if (!deferBody) this.ensureBody();

    this.pose();
  }

  /** Whether the skinned body exists; the ride scene defers it past the first frame. */
  hasBody(): boolean {
    return this.bodyValue !== undefined;
  }

  /** The skinned rider body, built on first use. */
  get body(): RiderBody {
    return this.ensureBody();
  }

  private ensureBody(): RiderBody {
    if (this.bodyValue === undefined) {
      this.bodyValue = new RiderBody(riderJoints(this.bike.geometry, BIND_CRANK_RAD));
      this.model.add(this.bodyValue.root);
    }

    return this.bodyValue;
  }

  get rig(): RiderBody["rig"] {
    return this.body.rig;
  }

  /** Skinned rider meshes of the current kit, one per material. */
  meshes(): ReturnType<RiderBody["meshes"]> {
    return this.body.meshes();
  }

  setKit(kit: Parameters<RiderBody["setKit"]>[0]): boolean {
    return this.body.setKit(kit);
  }

  /** Joints for the current bike fit and crank angle. */
  joints(): RiderJoints {
    return riderJoints(this.bike.geometry, this.crankRad);
  }

  /** Poses rider and bike for a crank angle (keeps the current wheel angle). */
  poseAt(crankRad: number): void {
    this.crankRad = crankRad;
    this.pose();
  }

  private pose(): void {
    const joints = this.joints();
    const [right, left] = joints.legs;

    this.bodyValue?.pose(joints);
    this.bike.setMotion(this.crankRad, this.wheelRad, [right.footPitchRad, left.footPitchRad]);
  }

  setLook(config: AvatarConfig): void {
    const look = avatarLook(config);

    this.body.setKit(look.kit);
    this.body.setColors(config.rider);
    this.bike.setVariant(look.frame, look.wheels);
    this.bike.setColors(config.bike.frameColor);
    this.pose();
  }

  posePreview(): void {
    this.wheelRad = 0.6;
    this.poseAt(Math.PI / 2);
  }

  update(frame: FrameInput): void {
    const { ride } = frame;
    const elapsedS = this.lastRideS === undefined ? 0 : ride.tS - this.lastRideS;

    this.lastRideS = ride.tS;
    this.crankRad = advanceCrankRad(this.crankRad, ride.cadenceRpm, elapsedS);
    this.wheelRad = wheelAngleRad(ride.distanceM, this.wheelCircM);
    this.headingRad = ride.headingRad;
    this.root.position.set(ride.worldPos.x, ride.worldPos.y + 0.04, ride.worldPos.z);
    this.root.rotation.y = -ride.headingRad;
    this.model.rotation.z = Math.atan(ride.gradePct / 100);

    if (this.deferBody) {
      // The first frame shows world and bike; the rider body joins on the next update.
      this.deferBody = false;
    } else {
      this.ensureBody();
    }

    this.pose();
  }

  dispose(): void {
    this.bodyValue?.dispose();
    disposeObject(this.root);
  }
}

export interface RiderView {
  readonly system: RenderSystem;
  readonly position: () => { readonly x: number; readonly y: number; readonly z: number };
  readonly headingRad: () => number;
  readonly crankRad: () => number;
  /** Applies on the next update, after the deferred body exists (spec E7-05 AK8). */
  readonly setLook: (config: Readonly<AvatarConfig>) => void;
  /** The look the rider wears or will wear on the next update. */
  readonly look: () => AvatarConfig;
}

export function createRiderModel(wheelCircM: number): RiderOnBike {
  return new RiderOnBike(wheelCircM);
}

/** Equal looks; the schema fixes the key order of both sides. */
function sameLook(left: Readonly<AvatarConfig>, right: Readonly<AvatarConfig>): boolean {
  return (
    JSON.stringify(AvatarConfigSchema.parse(left)) ===
    JSON.stringify(AvatarConfigSchema.parse(right))
  );
}

export function createRider(wheelCircM: number): RiderView {
  const rider = new RiderOnBike(wheelCircM, true);
  let worn: AvatarConfig = DEFAULT_AVATAR_CONFIG;
  let pending: AvatarConfig | undefined;

  return {
    setLook(config) {
      // An unchanged look (e.g. a guest's default) must not rebuild bike and body mid-ride.
      if (sameLook(config, worn)) return;
      worn = config;
      pending = config;
    },
    look: () => worn,
    position: () => ({
      x: rider.root.position.x,
      y: rider.root.position.y,
      z: rider.root.position.z,
    }),
    headingRad: () => rider.headingRad,
    crankRad: () => rider.crankRad,
    system: {
      id: "riders",
      order: 40,
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The rider system installs its model in the owned Three scene.
      init(context) {
        context.scene.add(rider.root);
      },
      update(frame) {
        rider.update(frame);

        // A look waits for the deferred body; applying it earlier would build the body in frame 1.
        if (pending !== undefined && rider.hasBody()) {
          rider.setLook(pending);
          pending = undefined;
        }
      },
      setQuality() {},
      dispose() {
        rider.dispose();
      },
    },
  };
}
