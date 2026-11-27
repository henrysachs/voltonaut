import * as THREE from "three";

import { CARRIED, DressingGroup, STANDS, type Footing } from "./dressing-group.js";
import { settledHeightAt } from "./heightfield.js";
import { HOME_STRETCH_M, type LandscapePlan, type Plant } from "./landscape-plan.js";

/** Every plant part sits this far into the ground it stands on. */
const PLANT_SINK_M = 0.18;

/** Trunk radius at its foot (CylinderGeometry bottom radius 1) as a fraction of the plant's. */
const TRUNK_RADIUS_FRACTION = 0.15;

/** Ground height a plant's parts stand on. */
type GroundOf = (plant: Readonly<Plant>) => number;

/** Rocks keep their planned ground point: they sit 0.18 m into it and reach no rim. */
const rockGround: GroundOf = ({ position }) => position.y;

function flatMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
}

interface PlantLayer {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  readonly heightFraction: number;
  readonly radiusFraction: number;
  readonly centerFraction: number;
  readonly footing: Footing;
}

function plantInstances(
  plants: readonly Plant[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three meshes share these system-owned geometry and material resources.
  layer: PlantLayer,
  groundOf: GroundOf,
): THREE.InstancedMesh {
  const { geometry, material, heightFraction, radiusFraction, centerFraction } = layer;
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length);

  const transform = new THREE.Object3D();
  const tint = new THREE.Color();

  for (const [index, plant] of plants.entries()) {
    transform.position.set(
      plant.position.x,
      groundOf(plant) + plant.heightM * centerFraction - PLANT_SINK_M,
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
      material: flatMaterial(0x79634b),
      heightFraction: 0.6,
      radiusFraction: TRUNK_RADIUS_FRACTION,
      centerFraction: 0.3,
      footing: STANDS,
    },
    {
      geometry: new THREE.ConeGeometry(1, 1, 7),
      material: flatMaterial(0x315e4d),
      heightFraction: 0.65,
      radiusFraction: 1,
      centerFraction: 0.52,
      footing: CARRIED,
    },
    {
      geometry: new THREE.ConeGeometry(1, 1, 7),
      material: flatMaterial(0x4c7b56),
      heightFraction: 0.5,
      radiusFraction: 0.76,
      centerFraction: 0.78,
      footing: CARRIED,
    },
    {
      geometry: new THREE.IcosahedronGeometry(1, 0),
      material: flatMaterial(0x8e9582),
      heightFraction: 1,
      radiusFraction: 1,
      centerFraction: 0.3,
      footing: STANDS,
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

export function createScenery(plan: LandscapePlan): DressingGroup {
  const root = new DressingGroup();
  const layers = createLayers();

  // A tree on a slope sinks until its trunk foot meets the ground on the downhill side too (#138).
  const treeGround: GroundOf = ({ position, radiusM }) =>
    settledHeightAt(plan.terrain, position.x, position.z, {
      radiusM: radiusM * TRUNK_RADIUS_FRACTION,
      sinkM: PLANT_SINK_M,
    });

  root.name = "forest-and-rocks";

  for (const [index, layer] of layers.entries()) {
    const rocks = index === 3;

    for (const plants of chunkPlants(rocks ? plan.rocks : plan.trees, plan.stretchesM).values()) {
      root.place(layer.footing, plantInstances(plants, layer, rocks ? rockGround : treeGround));
    }
  }

  return root;
}
