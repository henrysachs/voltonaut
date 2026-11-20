import * as THREE from "three";

import { disposeObject } from "./resources.js";
import { QUALITY_SETTINGS, type RenderSystem } from "./scheduler.js";

export function createEnvironmentSystem(): RenderSystem {
  const root = new THREE.Group();
  const sun = new THREE.DirectionalLight(0xffefd7, 3);

  return {
    id: "environment",
    order: 10,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its objects into the owned Three scene.
    init(context) {
      context.scene.background = new THREE.Color(0xa6cbd3);
      context.scene.fog = new THREE.Fog(0xa6cbd3, 100, 550);

      sun.position.set(-25, 45, 30);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -18;
      sun.shadow.camera.right = 18;
      sun.shadow.camera.top = 18;
      sun.shadow.camera.bottom = -18;
      sun.shadow.camera.far = 140;
      sun.shadow.normalBias = 0.04;
      root.add(sun, sun.target, new THREE.HemisphereLight(0xd5f2ff, 0x657b40, 2));
      context.scene.add(root);
    },
    update(frame) {
      const { x, y, z } = frame.ride.worldPos;

      sun.position.set(x - 25, y + 45, z + 30);
      sun.target.position.set(x, y, z);
    },
    setQuality(quality) {
      sun.castShadow = QUALITY_SETTINGS[quality].shadows;
    },
    dispose() {
      sun.shadow.dispose();
      disposeObject(root);
    },
  };
}
