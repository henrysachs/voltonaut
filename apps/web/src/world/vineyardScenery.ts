/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import * as THREE from "three";

import { CARRIED, DressingGroup, STANDS } from "./dressing-group.js";
import type { LandscapePlan } from "./landscape-plan.js";
import { planVineyard } from "./vineyard-decor.js";
import {
  VINE_ROW_HEIGHT_M,
  VINE_ROW_OVERHANG_M,
  VINE_ROW_SINK_M,
  VINE_ROW_WIDTH_M,
  type VineChord,
} from "./vineyard-footing.js";
import {
  HOUSE_DEPTH_M,
  HOUSE_HEIGHT_M,
  HOUSE_WIDTH_M,
  type Cypress,
  type StoneHouse,
} from "./vineyard-plan.js";

function instances<T>(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: readonly T[],
  place: (item: Readonly<T>, object: THREE.Object3D, color: THREE.Color) => void,
  castShadow: boolean,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const object = new THREE.Object3D();
  const color = new THREE.Color();

  for (const [index, item] of items.entries()) {
    place(item, object, color);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
    mesh.setColorAt(index, color);
  }

  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();

  return mesh;
}

const BODY = new THREE.Vector3(HOUSE_WIDTH_M, HOUSE_HEIGHT_M, HOUSE_DEPTH_M);

function plainMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
}

function vineRows(chords: readonly VineChord[]): THREE.InstancedMesh {
  const mesh = instances(
    new THREE.BoxGeometry(1, 1, 1),
    plainMaterial(),
    chords,
    (chord, object, color) => {
      const { position } = chord;

      object.position.set(
        position.x,
        position.y + VINE_ROW_HEIGHT_M / 2 - VINE_ROW_SINK_M,
        position.z,
      );
      object.rotation.set(0, chord.yawRad, 0);
      object.scale.set(chord.lengthM + VINE_ROW_OVERHANG_M, VINE_ROW_HEIGHT_M, VINE_ROW_WIDTH_M);
      color.setHSL(0.24 + ((chord.position.x * 7 + chord.position.z * 3) % 10) * 0.004, 0.42, 0.3);
    },
    false,
  );

  mesh.name = "vine-rows";

  return mesh;
}

function cypressCones(cypresses: readonly Cypress[]): THREE.InstancedMesh {
  const mesh = instances(
    new THREE.ConeGeometry(1, 1, 6),
    plainMaterial(),
    cypresses,
    (cypress, object, color) => {
      const { position, heightM, radiusM, shade } = cypress;

      object.position.set(position.x, position.y + heightM / 2 - 0.1, position.z);
      object.rotation.set(0, 0, 0);
      object.scale.set(radiusM, heightM, radiusM);
      color.setHSL(0.38, 0.35, 0.14 + shade * 0.07);
    },
    true,
  );

  mesh.name = "cypresses";

  return mesh;
}

interface HouseBoxes {
  readonly walls: THREE.InstancedMesh;
  readonly roofs: THREE.InstancedMesh;
}

function houseBoxes(houses: readonly StoneHouse[]): HouseBoxes {
  const walls = instances(
    new THREE.BoxGeometry(1, 1, 1),
    plainMaterial(),
    houses,
    (house, object, color) => {
      object.position.set(house.position.x, house.position.y + BODY.y / 2 - 0.5, house.position.z);
      object.rotation.set(0, house.yawRad, 0);
      object.scale.copy(BODY);
      color.setHSL(0.1, 0.18, 0.6 + house.shade * 0.1);
    },
    true,
  );

  const roofs = instances(
    new THREE.BoxGeometry(1, 1, 1),
    plainMaterial(),
    houses,
    (house, object, color) => {
      object.position.set(house.position.x, house.position.y + BODY.y - 0.2, house.position.z);
      object.rotation.set(0, house.yawRad, 0);
      object.scale.set(BODY.x + 1, 0.6, BODY.z + 1);
      color.setHSL(0.04, 0.5, 0.33 + house.shade * 0.06);
    },
    true,
  );

  walls.name = "stone-houses";
  roofs.name = "house-roofs";

  return { walls, roofs };
}

/**
 * Vineyard hills: vine rows along the contour lines of the raster as one instanced box,
 * cypress cones and a few stone houses (body and roof boxes), all instanced. Rows, cones and
 * walls stand on the drawn ground; roofs are carried by their walls.
 */
export function createVineyardScenery(plan: Readonly<LandscapePlan>): DressingGroup {
  const { chords, cypresses, houses } = planVineyard(plan);
  const { walls, roofs } = houseBoxes(houses);
  const root = new DressingGroup();

  root.name = "biome-vineyard";
  root.place(STANDS, vineRows(chords), cypressCones(cypresses), walls);
  root.place(CARRIED, roofs);

  return root;
}
