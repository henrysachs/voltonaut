import { planItemBoxes } from "@voltonaut/engine";
import * as THREE from "three";

import { disposeObject } from "./resources.js";
import type { RenderSystem, SceneContext } from "./scheduler.js";

const BOX_SIZE_M = 1.1;
const FLOAT_HEIGHT_M = 1.4;
const SPIN_RAD_PER_S = 1.5;

function boxPositions(route: Readonly<SceneContext["route"]>): readonly THREE.Vector3[] {
  return planItemBoxes(route).map((distanceM) => {
    const road = route.worldPos(distanceM);

    return new THREE.Vector3(road.x, road.y + FLOAT_HEIGHT_M, road.z);
  });
}

function boxMesh(count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(BOX_SIZE_M, BOX_SIZE_M, BOX_SIZE_M),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x6b4f00, roughness: 0.4 }),
    count,
  );

  mesh.name = "item-boxes";
  mesh.visible = false;

  return mesh;
}

/**
 * Fun-mode item boxes (spec E9-01 AK9): one instanced draw call, floating over
 * the road at the engine's planned positions, visible only in fun mode.
 */
export function createItemBoxSystem(): RenderSystem {
  const root = new THREE.Group();
  const transform = new THREE.Object3D();
  let positions: readonly THREE.Vector3[] = [];
  let mesh: THREE.InstancedMesh | undefined;

  const place = (spinRad: number): void => {
    if (mesh === undefined) return;

    for (const [index, position] of positions.entries()) {
      transform.position.copy(position);
      transform.rotation.set(Math.PI / 5, spinRad, Math.PI / 5);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    id: "item-boxes",
    order: 25,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its owned instanced mesh into the Three scene.
    init(context) {
      positions = boxPositions(context.route);
      mesh = boxMesh(positions.length);
      place(0);
      mesh.computeBoundingSphere();
      root.add(mesh);
      context.scene.add(root);
    },
    update(frame) {
      if (mesh === undefined) return;

      mesh.visible = frame.ride.mode.kind === "fun";

      if (mesh.visible) place(frame.ride.tS * SPIN_RAD_PER_S);
    },
    setQuality() {},
    dispose() {
      disposeObject(root);
    },
  };
}
