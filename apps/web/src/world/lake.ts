import * as THREE from "three";

import type { LandscapePlan } from "./landscape-plan.js";

/** The lake water with its glints, placed on the plan's lake ellipse. */
export function createLake(plan: LandscapePlan): THREE.Group {
  const root = new THREE.Group();

  const glints = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x80bec0,
      roughness: 0.4,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
    28,
  );

  const transform = new THREE.Object3D();

  for (let index = 0; index < 28; index += 1) {
    const angle = index * 2.4;
    const radius = Math.sqrt((index + 0.5) / 28) * 0.83;

    transform.position.set(
      Math.cos(angle) * radius * plan.lake.alongRadiusM,
      0.025,
      Math.sin(angle) * radius * plan.lake.acrossRadiusM,
    );
    transform.rotation.x = -Math.PI / 2;
    transform.scale.set(2 + (index % 4), 0.12, 1);
    transform.updateMatrix();
    glints.setMatrixAt(index, transform.matrix);
  }

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshStandardMaterial({ color: 0x328c98, roughness: 0.26, metalness: 0.2 }),
  );

  water.name = "lake-water";
  water.rotation.x = -Math.PI / 2;
  water.scale.set(plan.lake.alongRadiusM, plan.lake.acrossRadiusM, 1);
  root.rotation.y = -plan.lake.headingRad;
  root.position.set(plan.lake.center.x, plan.lake.waterYM, plan.lake.center.z);
  root.add(water, glints);

  return root;
}
