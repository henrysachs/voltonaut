import * as THREE from "three";

import { createBillboardMotifTexture } from "./billboard-motif.js";
import {
  BILLBOARD_CENTER_Y_M as BOARD_CENTER_Y_M,
  BILLBOARD_HEIGHT_M,
  BILLBOARD_VARIANTS,
  BILLBOARD_WIDTH_M,
  type Billboard,
  type BillboardSide,
} from "./billboard-plan.js";
import { CARRIED, DressingGroup, type Footing } from "./dressing-group.js";

const FRAME_DEPTH_M = 0.12;
const FRAME_MARGIN_M = 0.1;
const POST_OFFSET_M = 1.5;
const POST_SIZE_M = 0.16;

/** Posts reach below the sampled ground so they never float on uneven terrain. */
const POST_SINK_M = 1;
const STRUCTURE_PARTS = 3;

/** Structure instances per board: the frame, carried by its two standing posts. */
const STRUCTURE_FOOTING: Footing = { kind: "prop", roles: ["carried", "stands", "stands"] };

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
  // No shadow casting: the shadow pass would add a third draw call (#42: all billboards ≤ 2).
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();

  return mesh;
}

/** Moves the map UV of each instance into its atlas cell (one cell per motif variant). */
export function withVariantUv(vertexShader: string): string {
  return vertexShader
    .replace("#include <common>", "#include <common>\nattribute float instanceVariant;")
    .replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv.x = ( vMapUv.x + instanceVariant ) / ${BILLBOARD_VARIANTS}.0;\n#endif`,
    );
}

/** Road side per face instance, for the render diagnostics. */
const FACE_SIDES = new WeakMap<THREE.Object3D, readonly BillboardSide[]>();

/** Board plane with per-instance motif variant. */
function faceGeometry(billboards: readonly Billboard[]): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(BILLBOARD_WIDTH_M, BILLBOARD_HEIGHT_M);

  geometry.setAttribute(
    "instanceVariant",
    new THREE.InstancedBufferAttribute(
      Float32Array.from(billboards, (billboard) => billboard.variant),
      1,
    ),
  );

  return geometry;
}

function faceMaterial(): THREE.MeshStandardMaterial {
  const texture = createBillboardMotifTexture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });

  material.addEventListener("dispose", () => {
    texture.dispose();
  });
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three hands the mutable shader source to this hook for patching.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = withVariantUv(shader.vertexShader);
  };

  return material;
}

function faceInstances(billboards: readonly Billboard[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(faceGeometry(billboards), faceMaterial(), billboards.length);

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
  FACE_SIDES.set(
    mesh,
    billboards.map((billboard) => billboard.side),
  );
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();

  return mesh;
}

/** All roadside billboards in two instanced draw calls: structure and motif faces. */
export function createBillboards(billboards: readonly Billboard[]): DressingGroup {
  const root = new DressingGroup();

  root.name = "billboards";
  root.place(STRUCTURE_FOOTING, structureInstances(billboards));
  root.place(CARRIED, faceInstances(billboards));

  return root;
}

export interface BillboardsInView {
  readonly left: number;
  readonly right: number;
}

function frustumOf(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three cameras expose their matrices as mutable members.
  camera: THREE.Camera,
): THREE.Frustum {
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

/** Billboard faces whose centre lies in the camera frustum, per road side (render diagnostics). */
export function billboardsInView(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph lookup reads the owned mutable objects.
  scene: THREE.Object3D,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three cameras expose their matrices as mutable members.
  camera: THREE.Camera,
): BillboardsInView {
  const faces = scene.getObjectByName("billboard-faces");
  const sides = faces === undefined ? undefined : FACE_SIDES.get(faces);

  if (faces instanceof THREE.InstancedMesh && sides !== undefined)
    return countInView(faces, sides, frustumOf(camera));

  return { left: 0, right: 0 };
}

function countInView(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- getMatrixAt reads the owned mutable instanced mesh.
  faces: THREE.Object3D & Pick<THREE.InstancedMesh, "count" | "getMatrixAt">,
  sides: readonly BillboardSide[],
  frustum: Readonly<Pick<THREE.Frustum, "containsPoint">>,
): BillboardsInView {
  const matrix = new THREE.Matrix4();
  const centre = new THREE.Vector3();
  let left = 0;
  let right = 0;

  for (let index = 0; index < faces.count; index += 1) {
    faces.getMatrixAt(index, matrix);
    centre.setFromMatrixPosition(matrix).applyMatrix4(faces.matrixWorld);

    if (frustum.containsPoint(centre)) {
      if (sides[index] === -1) left += 1;
      else right += 1;
    }
  }

  return { left, right };
}
