import * as THREE from "three";

import { createBillboardMotifTexture } from "./billboard-motif.js";
import { BILLBOARD_HEIGHT_M, BILLBOARD_WIDTH_M, type Billboard } from "./billboard-plan.js";

/** Height of the board centre above the ground point. */
const BOARD_CENTER_Y_M = 3;
const FRAME_DEPTH_M = 0.12;
const FRAME_MARGIN_M = 0.1;
const POST_OFFSET_M = 1.5;
const POST_SIZE_M = 0.16;

/** Posts reach below the sampled ground so they never float on uneven terrain. */
const POST_SINK_M = 1;
const STRUCTURE_PARTS = 3;

function structureInstances(billboards: readonly Billboard[]): THREE.InstancedMesh {
  const material = new THREE.MeshStandardMaterial({ color: 0x2f3437, roughness: 0.8 });

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    billboards.length * STRUCTURE_PARTS,
  );

  const board = new THREE.Object3D();
  const part = new THREE.Object3D();
  const postHeightM = BOARD_CENTER_Y_M + POST_SINK_M;

  const parts = [
    {
      position: new THREE.Vector3(0, BOARD_CENTER_Y_M, -FRAME_DEPTH_M / 2),
      scale: new THREE.Vector3(
        BILLBOARD_WIDTH_M + 2 * FRAME_MARGIN_M,
        BILLBOARD_HEIGHT_M + 2 * FRAME_MARGIN_M,
        FRAME_DEPTH_M,
      ),
    },
    ...[-POST_OFFSET_M, POST_OFFSET_M].map((xM) => ({
      position: new THREE.Vector3(xM, postHeightM / 2 - POST_SINK_M, -FRAME_DEPTH_M * 1.5),
      scale: new THREE.Vector3(POST_SIZE_M, postHeightM, POST_SIZE_M),
    })),
  ];

  board.add(part);

  for (const [index, billboard] of billboards.entries()) {
    board.position.set(billboard.position.x, billboard.position.y, billboard.position.z);
    board.rotation.set(0, billboard.yawRad, 0);

    for (const [partIndex, { position, scale }] of parts.entries()) {
      part.position.copy(position);
      part.scale.copy(scale);
      board.updateMatrixWorld(true);
      mesh.setMatrixAt(index * STRUCTURE_PARTS + partIndex, part.matrixWorld);
    }
  }

  mesh.name = "billboard-structure";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();

  return mesh;
}

function faceInstances(billboards: readonly Billboard[]): THREE.InstancedMesh {
  const texture = createBillboardMotifTexture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });

  material.addEventListener("dispose", () => {
    texture.dispose();
  });

  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(BILLBOARD_WIDTH_M, BILLBOARD_HEIGHT_M),
    material,
    billboards.length,
  );

  const transform = new THREE.Object3D();

  for (const [index, billboard] of billboards.entries()) {
    transform.position.set(
      billboard.position.x,
      billboard.position.y + BOARD_CENTER_Y_M,
      billboard.position.z,
    );
    transform.rotation.set(0, billboard.yawRad, 0);
    transform.translateZ(0.01);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  mesh.name = "billboard-faces";
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();

  return mesh;
}

/** All roadside billboards in two instanced draw calls: structure and motif faces. */
export function createBillboards(billboards: readonly Billboard[]): THREE.Group {
  const root = new THREE.Group();

  root.name = "billboards";
  root.add(structureInstances(billboards), faceInstances(billboards));

  return root;
}
