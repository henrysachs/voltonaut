import type { EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";

import { offsetPosition } from "./lake-plan.js";
import { planWaymarks } from "./waymark-plan.js";

const DIGITS = [
  "abcedf",
  "bc",
  "abged",
  "abgcd",
  "fgbc",
  "afgcd",
  "afgecd",
  "abc",
  "abcdefg",
  "abfgcd",
];

const SEGMENTS = [
  ["a", 0, 0.24, 0.22, 0.045],
  ["g", 0, 0, 0.22, 0.045],
  ["d", 0, -0.24, 0.22, 0.045],
  ["f", -0.12, 0.12, 0.045, 0.2],
  ["b", 0.12, 0.12, 0.045, 0.2],
  ["e", -0.12, -0.12, 0.045, 0.2],
  ["c", 0.12, -0.12, 0.045, 0.2],
] satisfies [string, number, number, number, number][];

function createDashes(route: EngineRoute): THREE.InstancedMesh {
  const count = Math.ceil(route.lengthM / 12);
  const paint = new THREE.MeshStandardMaterial({ color: 0xf3e7b8, roughness: 0.85 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const dashes = new THREE.InstancedMesh(box, paint, count);
  const transform = new THREE.Object3D();

  for (let index = 0; index < count; index += 1) {
    const distanceM = index * 12;
    const position = route.worldPos(distanceM);

    transform.position.set(position.x, position.y + 0.045, position.z);
    transform.rotation.set(
      0,
      -route.headingRad(distanceM),
      Math.atan(route.profile.gradeAt(distanceM, 4) / 100),
    );
    transform.scale.set(3, 0.012, 0.12);
    transform.updateMatrix();
    dashes.setMatrixAt(index, transform.matrix);
  }

  return dashes;
}

export function createWaymarks(route: EngineRoute): THREE.Group {
  const root = new THREE.Group();
  const signs = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xf3e7b8, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x254c47, roughness: 0.9 });
  const box = new THREE.BoxGeometry(1, 1, 1);

  root.add(createDashes(route));

  for (const { km, distanceM, lateralM } of planWaymarks(route)) {
    const position = offsetPosition(route, distanceM, lateralM);
    const sign = new THREE.Group();
    const post = new THREE.Mesh(box, paint);
    const board = new THREE.Mesh(box, dark);

    post.scale.set(0.1, 1.65, 0.1);
    post.position.y = 0.8;
    board.scale.set(0.12, 0.8, 0.65);
    board.position.y = 1.65;
    sign.add(post, board);

    for (const [name, x, y, width, height] of SEGMENTS) {
      if ((DIGITS[km % 10] ?? "").includes(name)) {
        const segment = new THREE.Mesh(box, paint);

        segment.position.set(-0.07, 1.65 + y, x);
        segment.scale.set(0.02, height, width);
        sign.add(segment);
      }
    }

    sign.position.set(position.x, position.y, position.z);
    sign.rotation.y = -route.headingRad(distanceM);
    signs.add(sign);
  }

  signs.updateMatrixWorld(true);
  root.add(batchSigns(signs, box, paint), batchSigns(signs, box, dark));

  return root;
}

function batchSigns(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal reads the owned sign transforms before batching.
  signs: Readonly<THREE.Group>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The batch takes ownership of this shared Three geometry.
  geometry: THREE.BoxGeometry,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The batch takes ownership of this shared Three material.
  material: THREE.MeshStandardMaterial,
): THREE.InstancedMesh {
  const matrices: THREE.Matrix4[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable Object3D contract.
  signs.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material === material) {
      matrices.push(object.matrixWorld.clone());
    }
  });
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);

  for (const [index, matrix] of matrices.entries()) {
    mesh.setMatrixAt(index, matrix);
  }

  return mesh;
}
