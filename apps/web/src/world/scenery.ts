import * as THREE from "three";

import { HOME_STRETCH_M, type LandscapePlan, type Plant } from "./landscape-plan.js";

interface PlantLayer {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  readonly heightFraction: number;
  readonly radiusFraction: number;
  readonly centerFraction: number;
}

function plantInstances(
  plants: readonly Plant[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three meshes share these system-owned geometry and material resources.
  layer: PlantLayer,
): THREE.InstancedMesh {
  const { geometry, material, heightFraction, radiusFraction, centerFraction } = layer;
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length);

  const transform = new THREE.Object3D();
  const tint = new THREE.Color();

  for (const [index, plant] of plants.entries()) {
    transform.position.set(
      plant.position.x,
      plant.position.y + plant.heightM * centerFraction - 0.18,
      plant.position.z,
    );
    transform.rotation.y = plant.rotationRad;
    transform.scale.set(
      plant.radiusM * radiusFraction,
      plant.heightM * heightFraction,
      plant.radiusM * radiusFraction,
    );
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    tint.setHSL(0.29 + plant.shade * 0.06, 0.18, 0.65 + plant.shade * 0.25);
    mesh.setColorAt(index, tint);
  }

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();

  return mesh;
}

function createLayers(): readonly PlantLayer[] {
  return [
    {
      geometry: new THREE.CylinderGeometry(0.55, 1, 1, 5),
      material: new THREE.MeshStandardMaterial({
        color: 0x79634b,
        roughness: 1,
        flatShading: true,
      }),
      heightFraction: 0.6,
      radiusFraction: 0.15,
      centerFraction: 0.3,
    },
    {
      geometry: new THREE.ConeGeometry(1, 1, 7),
      material: new THREE.MeshStandardMaterial({
        color: 0x315e4d,
        roughness: 1,
        flatShading: true,
      }),
      heightFraction: 0.65,
      radiusFraction: 1,
      centerFraction: 0.52,
    },
    {
      geometry: new THREE.ConeGeometry(1, 1, 7),
      material: new THREE.MeshStandardMaterial({
        color: 0x4c7b56,
        roughness: 1,
        flatShading: true,
      }),
      heightFraction: 0.5,
      radiusFraction: 0.76,
      centerFraction: 0.78,
    },
    {
      geometry: new THREE.IcosahedronGeometry(1, 0),
      material: new THREE.MeshStandardMaterial({
        color: 0x8e9582,
        roughness: 1,
        flatShading: true,
      }),
      heightFraction: 1,
      radiusFraction: 1,
      centerFraction: 0.3,
    },
  ];
}

/** Plants grouped per road in stretches, so each instanced mesh culls compactly. */
function chunkPlants(
  plants: readonly Plant[],
  stretchesM: readonly number[],
): ReadonlyMap<string, readonly Plant[]> {
  const chunks = new Map<string, Plant[]>();

  for (const plant of plants) {
    const key = `${plant.roadIndex}:${Math.floor(plant.routeDistanceM / (stretchesM[plant.roadIndex] ?? HOME_STRETCH_M))}`;
    const chunk = chunks.get(key) ?? [];

    chunk.push(plant);
    chunks.set(key, chunk);
  }

  return chunks;
}

export function createScenery(plan: LandscapePlan): THREE.Group {
  const root = new THREE.Group();
  const layers = createLayers();

  root.name = "forest-and-rocks";

  for (const [index, layer] of layers.entries()) {
    for (const plants of chunkPlants(
      index === 3 ? plan.rocks : plan.trees,
      plan.stretchesM,
    ).values()) {
      root.add(plantInstances(plants, layer));
    }
  }

  return root;
}
