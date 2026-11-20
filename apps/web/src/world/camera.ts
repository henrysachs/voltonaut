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
        const heading = frame.ride.headingRad;
        const forwardX = Math.cos(heading);
        const forwardZ = Math.sin(heading);
        const { behindM, sideM, heightM } = CAMERA_OFFSETS[mode];

        if (initialized) {
          movement.set(x, y, z).sub(previousPosition);
          camera.position.add(movement);
          target.add(movement);
        }

        previousPosition.set(x, y, z);
        desired.set(
          x - forwardX * behindM - forwardZ * sideM,
          y + heightM,
          z - forwardZ * behindM + forwardX * sideM,
        );
        look.set(x + forwardX * 3, y + 0.95, z + forwardZ * 3);
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
