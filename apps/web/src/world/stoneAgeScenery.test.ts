/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only traverse them. */
import { TEST_ROUTES, createRoute, type RouteData } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createStoneAgeScenery } from "./biomeScenery.js";
import { routeClearanceM, routeCorridorSamples } from "./biomeSceneryShared.js";
import {
  createLandscapePlan,
  PLANT_ROAD_CLEARANCE_M,
  type LandscapePlan,
} from "./landscape-plan.js";

function felsentalData(): RouteData {
  const data = TEST_ROUTES["felsental"];

  if (data === undefined) throw new TypeError("felsental must be a registered route");

  return data;
}

function stoneAgePlan(): LandscapePlan {
  const route = createRoute(felsentalData());

  return createLandscapePlan(route, [route], 42, false);
}

interface Footprint {
  readonly name: string;
  readonly position: THREE.Vector3;
  /** Farthest horizontal distance of any vertex from the instance origin. */
  readonly reachM: number;
}

function isInstanced(object: Readonly<THREE.Object3D>): object is THREE.InstancedMesh {
  return object instanceof THREE.InstancedMesh;
}

function instancedMeshes(root: Readonly<THREE.Object3D>): readonly THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];

  root.traverse((object) => {
    if (isInstanced(object)) meshes.push(object);
  });

  return meshes;
}

/** Every instance as the horizontal circle around its origin that holds all its vertices. */
function instanceFootprints(root: Readonly<THREE.Object3D>): readonly Footprint[] {
  const footprints: Footprint[] = [];
  const matrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();

  for (const mesh of instancedMeshes(root)) {
    const vertices = mesh.geometry.getAttribute("position");

    for (let index = 0; index < mesh.count; index += 1) {
      mesh.getMatrixAt(index, matrix);

      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      let reachM = 0;

      for (let corner = 0; corner < vertices.count; corner += 1) {
        vertex.fromBufferAttribute(vertices, corner).applyMatrix4(matrix);
        reachM = Math.max(reachM, Math.hypot(vertex.x - position.x, vertex.z - position.z));
      }

      footprints.push({ name: mesh.name, position, reachM });
    }
  }

  return footprints;
}

/** Smallest gap between any instance footprint of the named layer and the road centerline. */
function roadGapM(footprints: readonly Footprint[], route: Readonly<LandscapePlan["route"]>) {
  const road = routeCorridorSamples(route, 1);

  return Math.min(
    ...footprints.map((footprint) => routeClearanceM(footprint.position, road) - footprint.reachM),
  );
}

function instanceMatrices(root: Readonly<THREE.Object3D>): readonly number[] {
  return instancedMeshes(root).flatMap((mesh) => Array.from(mesh.instanceMatrix.array));
}

function layerCount(root: Readonly<THREE.Object3D>, name: string): number {
  return instancedMeshes(root)
    .filter((mesh) => mesh.name === name)
    .reduce((count, mesh) => count + mesh.count, 0);
}

function basicMaterials(root: Readonly<THREE.Object3D>): readonly THREE.MeshBasicMaterial[] {
  const materials: THREE.MeshBasicMaterial[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      materials.push(object.material);
    }
  });

  return materials;
}

it("stone age scenery is deterministic and dresses the valley with every decor kind", () => {
  const plan = stoneAgePlan();
  const first = createStoneAgeScenery(plan);
  const second = createStoneAgeScenery(plan);
  const statues = layerCount(first, "stone-age-dino-body");

  expect(first.name).toBe("biome-stone-age");
  expect(instanceMatrices(first)).toEqual(instanceMatrices(second));
  expect(layerCount(first, "stone-age-house")).toBeGreaterThanOrEqual(20);
  expect(layerCount(first, "stone-age-entrance")).toBe(layerCount(first, "stone-age-house"));
  expect(layerCount(first, "stone-age-door")).toBe(layerCount(first, "stone-age-house"));
  expect(layerCount(first, "stone-age-palm")).toBeGreaterThan(500);
  expect(layerCount(first, "stone-age-fern")).toBeGreaterThan(1000);
  expect(layerCount(first, "stone-age-boulder")).toBeGreaterThan(300);
  expect(statues).toBeGreaterThanOrEqual(8);
  expect(layerCount(first, "stone-age-dino-neck")).toBe(statues);
  expect(layerCount(first, "stone-age-dino-head")).toBe(statues);
  expect(layerCount(first, "stone-age-dino-tail")).toBe(statues);
  expect(layerCount(first, "stone-age-dino-legs")).toBe(statues * 4);
});

it("stone age scenery raises all four volcanoes with glowing craters far off the road", () => {
  const plan = stoneAgePlan();
  const scenery = createStoneAgeScenery(plan);
  const volcanoes = instanceFootprints(scenery).filter(({ name }) => name === "stone-age-volcano");
  const crater = scenery.getObjectByName("stone-age-crater");

  expect(volcanoes).toHaveLength(4);
  expect(layerCount(scenery, "stone-age-crater")).toBe(volcanoes.length);
  expect(crater).toBeInstanceOf(THREE.InstancedMesh);
  expect(basicMaterials(scenery).length).toBeGreaterThanOrEqual(2);
  expect(Math.min(...volcanoes.map(({ reachM }) => reachM))).toBeGreaterThan(150);
  expect(roadGapM(volcanoes, plan.route)).toBeGreaterThan(100);
  expect(scenery.children.some((child) => child instanceof THREE.Light)).toBe(false);
});

it("keeps every stone age instance with its footprint 7 m off the road centerline", () => {
  const plan = stoneAgePlan();
  const footprints = instanceFootprints(createStoneAgeScenery(plan));

  expect(footprints.length).toBeGreaterThan(5000);
  expect(roadGapM(footprints, plan.route)).toBeGreaterThanOrEqual(PLANT_ROAD_CLEARANCE_M);
});

/** Highest world y of each instance of the named layer, in instance order. */
function instanceTopsM(root: Readonly<THREE.Object3D>, name: string): readonly number[] {
  const matrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();

  return instancedMeshes(root)
    .filter((mesh) => mesh.name === name)
    .flatMap((mesh) => {
      const vertices = mesh.geometry.getAttribute("position");

      return Array.from({ length: mesh.count }, (_, index) => {
        mesh.getMatrixAt(index, matrix);

        let topM = Number.NEGATIVE_INFINITY;

        for (let corner = 0; corner < vertices.count; corner += 1) {
          topM = Math.max(
            topM,
            vertex.fromBufferAttribute(vertices, corner).applyMatrix4(matrix).y,
          );
        }

        return topM;
      });
    });
}

it("keeps every rock house door below the arch of its entrance tunnel", () => {
  const scenery = createStoneAgeScenery(stoneAgePlan());
  const doorTopsM = instanceTopsM(scenery, "stone-age-door");
  const archTopsM = instanceTopsM(scenery, "stone-age-entrance");

  const clearancesM = archTopsM.map((archTopM, index) => archTopM - Number(doorTopsM[index]));

  expect(doorTopsM).toHaveLength(archTopsM.length);
  expect(Math.min(...clearancesM)).toBeGreaterThan(0);
});

/** Position and scale of each instance of the named layer, in instance order. */
function instancePoses(
  root: Readonly<THREE.Object3D>,
  name: string,
): readonly { readonly position: THREE.Vector3; readonly scale: THREE.Vector3 }[] {
  const matrix = new THREE.Matrix4();

  return instancedMeshes(root)
    .filter((mesh) => mesh.name === name)
    .flatMap((mesh) =>
      Array.from({ length: mesh.count }, (_, index) => {
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();

        mesh.getMatrixAt(index, matrix);
        matrix.decompose(position, new THREE.Quaternion(), scale);

        return { position, scale };
      }),
    );
}

type Pose = ReturnType<typeof instancePoses>[number];

/**
 * Dome shell height above the arch top where each tunnel starts. Dome scale: radius in x, height
 * in y. Tunnel scale: arch radius in x, length along z. A missing dome yields NaN.
 */
function tunnelStartMarginsM(domes: readonly Pose[], tunnels: readonly Pose[]): readonly number[] {
  return tunnels.map((tunnel, index) => {
    const dome = domes[index];

    if (dome === undefined) return Number.NaN;

    const startM =
      Math.hypot(tunnel.position.x - dome.position.x, tunnel.position.z - dome.position.z) -
      tunnel.scale.z / 2;

    const shellM = dome.position.y + dome.scale.y * Math.sqrt(1 - (startM / dome.scale.x) ** 2);

    return shellM - (tunnel.position.y + tunnel.scale.x);
  });
}

it("starts every entrance tunnel where its dome is still taller than the arch", () => {
  const scenery = createStoneAgeScenery(stoneAgePlan());
  const domes = instancePoses(scenery, "stone-age-house");
  const tunnels = instancePoses(scenery, "stone-age-entrance");

  expect(tunnels).toHaveLength(domes.length);
  expect(Math.min(...tunnelStartMarginsM(domes, tunnels))).toBeGreaterThan(0.3);
});
