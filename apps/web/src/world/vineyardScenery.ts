/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's Object3D and Color are mutable scene resources; these layers own the instances they write. */
import * as THREE from "three";

import type { LandscapePlan } from "./landscape-plan.js";
import { planVineyard } from "./vineyard-decor.js";
import {
  HOUSE_DEPTH_M,
  HOUSE_HEIGHT_M,
  HOUSE_WIDTH_M,
  type Cypress,
  type StoneHouse,
  type VineChord,
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
      object.position.set(chord.position.x, chord.position.y + 0.5, chord.position.z);
      object.rotation.set(0, chord.yawRad, 0);
      object.scale.set(chord.lengthM + 0.2, 1.1, 0.9);
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

function houseBoxes(houses: readonly StoneHouse[]): readonly THREE.InstancedMesh[] {
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

  return [walls, roofs];
}

/**
 * Vineyard hills: vine rows along the contour lines of the raster as one instanced box,
 * cypress cones and a few stone houses (body and roof boxes), all instanced.
 */
export function createVineyardScenery(plan: Readonly<LandscapePlan>): THREE.Group {
  const { chords, cypresses, houses } = planVineyard(plan);
  const root = new THREE.Group();

  root.name = "biome-vineyard";
  root.add(vineRows(chords), cypressCones(cypresses), ...houseBoxes(houses));

  return root;
}
