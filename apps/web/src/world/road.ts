import type { EngineRoute, WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import { disposeObject } from "./resources.js";
import type { RenderSystem } from "./scheduler.js";

export interface RoadSample {
  readonly left: WorldPos;
  readonly right: WorldPos;
}

export function sampleRoad(route: EngineRoute, widthM: number, offsetM = 0): readonly RoadSample[] {
  const count = Math.ceil(route.lengthM / 4);
  const samples: RoadSample[] = [];

  for (let index = 0; index <= count; index += 1) {
    const distanceM = (index / count) * route.lengthM;
    const position = route.worldPos(distanceM);
    const heading = route.headingRad(distanceM);

    const edge = (lateralM: number): WorldPos => ({
      x: position.x - Math.sin(heading) * lateralM,
      y: position.y + 0.025,
      z: position.z + Math.cos(heading) * lateralM,
    });

    samples.push({ left: edge(offsetM - widthM / 2), right: edge(offsetM + widthM / 2) });
  }

  return samples;
}

function roadGeometry(samples: readonly RoadSample[]): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const [index, sample] of samples.entries()) {
    vertices.push(
      sample.left.x,
      sample.left.y,
      sample.left.z,
      sample.right.x,
      sample.right.y,
      sample.right.z,
    );

    if (index > 0) {
      const start = index * 2;

      indices.push(start - 2, start - 1, start, start, start - 1, start + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function roadsidePosts(
  route: EngineRoute,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three materials are mutable library resources owned by this system.
  material: THREE.MeshStandardMaterial,
): THREE.InstancedMesh {
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 0.9, 0.12),
    material,
    Math.ceil(route.lengthM / 24) * 2,
  );

  const marker = new THREE.Object3D();
  let instance = 0;

  for (let distanceM = 0; distanceM < route.lengthM; distanceM += 24) {
    const position = route.worldPos(distanceM);
    const heading = route.headingRad(distanceM);

    for (const side of [-1, 1]) {
      marker.position.set(
        position.x - Math.sin(heading) * side * 4.8,
        position.y + 0.45,
        position.z + Math.cos(heading) * side * 4.8,
      );
      marker.updateMatrix();
      posts.setMatrixAt(instance, marker.matrix);
      instance += 1;
    }
  }

  return posts;
}

export function createRoadSystem(): RenderSystem {
  const root = new THREE.Group();

  return {
    id: "road",
    order: 20,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its objects into the owned Three scene.
    init(context) {
      const asphalt = new THREE.MeshStandardMaterial({ color: 0x38444a, roughness: 0.95 });
      const paint = new THREE.MeshStandardMaterial({ color: 0xf0eacb, roughness: 0.8 });
      const shoulder = new THREE.MeshStandardMaterial({ color: 0xb9ae8a, roughness: 1 });
      const grass = new THREE.MeshStandardMaterial({ color: 0x69855d, roughness: 1 });

      for (const [widthM, offsetM, heightM, material] of [
        [800, 0, -0.08, grass],
        [8, 0, -0.02, shoulder],
        [7, 0, 0, asphalt],
        [0.09, -3.1, 0.01, paint],
        [0.09, 3.1, 0.01, paint],
      ] satisfies [number, number, number, THREE.MeshStandardMaterial][]) {
        const mesh = new THREE.Mesh(
          roadGeometry(sampleRoad(context.route, widthM, offsetM)),
          material,
        );

        mesh.position.y = heightM;
        mesh.receiveShadow = true;
        root.add(mesh);
      }

      root.add(roadsidePosts(context.route, paint));
      context.scene.add(root);
    },
    update() {},
    setQuality() {},
    dispose() {
      disposeObject(root);
    },
  };
}
