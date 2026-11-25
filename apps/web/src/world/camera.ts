import * as THREE from "three";

import { followFraction } from "../avatar/motion.js";
import type { RenderSystem } from "./scheduler.js";

export type CameraMode = "chase" | "overview";

interface CameraOffset {
  readonly behindM: number;
  readonly sideM: number;
  readonly heightM: number;
}

const CAMERA_OFFSETS: Readonly<Record<CameraMode, CameraOffset>> = {
  chase: { behindM: 5.5, sideM: 1.4, heightM: 2.8 },
  overview: { behindM: 6, sideM: 13, heightM: 9 },
};

export interface PoseXyz {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  readonly position: PoseXyz;
  readonly look: PoseXyz;
}

/** Target pose of the follow camera for a rider pose; the system eases towards it. */
export function cameraPose(mode: CameraMode, rider: PoseXyz, headingRad: number): CameraPose {
  const forwardX = Math.cos(headingRad);
  const forwardZ = Math.sin(headingRad);
  const { behindM, sideM, heightM } = CAMERA_OFFSETS[mode];

  return {
    position: {
      x: rider.x - forwardX * behindM - forwardZ * sideM,
      y: rider.y + heightM,
      z: rider.z - forwardZ * behindM + forwardX * sideM,
    },
    look: { x: rider.x + forwardX * 3, y: rider.y + 0.95, z: rider.z + forwardZ * 3 },
  };
}

export interface RideCamera {
  readonly system: RenderSystem;
  readonly toggle: () => void;
  readonly mode: () => CameraMode;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The camera system owns and updates the mutable Three camera pose.
export function createRideCamera(camera: Readonly<THREE.PerspectiveCamera>): RideCamera {
  let mode: CameraMode = "chase";
  let initialized = false;
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const look = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const movement = new THREE.Vector3();

  return {
    toggle() {
      mode = mode === "chase" ? "overview" : "chase";
    },
    mode: () => mode,
    system: {
      id: "camera",
      order: 80,
      init() {},
      update(frame) {
        const { x, y, z } = frame.ride.worldPos;
        const pose = cameraPose(mode, frame.ride.worldPos, frame.ride.headingRad);

        if (initialized) {
          movement.set(x, y, z).sub(previousPosition);
          camera.position.add(movement);
          target.add(movement);
        }

        previousPosition.set(x, y, z);
        desired.set(pose.position.x, pose.position.y, pose.position.z);
        look.set(pose.look.x, pose.look.y, pose.look.z);
        const fraction = initialized ? followFraction(frame.dtS) : 1;

        camera.position.lerp(desired, fraction);
        target.lerp(look, fraction);
        camera.lookAt(target);
        initialized = true;
      },
      setQuality() {},
      dispose() {},
    },
  };
}
