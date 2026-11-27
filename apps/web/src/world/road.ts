import type { EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";

import { disposeObject } from "./resources.js";
import type { RenderSystem } from "./scheduler.js";
import { createItemBoxSystem } from "./itemBoxes.js";
import { sampleRoad, type RoadSample } from "./road-plan.js";
import { createWaymarks } from "./waymarks.js";

/** One indexed geometry for any number of road ribbons; each ribbon stays its own strip. */
function roadGeometry(ribbons: readonly (readonly RoadSample[])[]): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const samples of ribbons) {
    const first = vertices.length / 3;

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
        const start = first + index * 2;

        indices.push(start - 2, start - 1, start, start, start - 1, start + 1);
      }
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

/** Shoulder, asphalt and both edge lines of the given roads, merged into one mesh per layer. */
function roadLayers(
  roads: readonly EngineRoute[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three materials are mutable library resources owned by this system.
  materials: Readonly<Record<"shoulder" | "asphalt" | "paint", THREE.MeshStandardMaterial>>,
): readonly THREE.Mesh[] {
  const layers = [
    [8, 0, -0.02, materials.shoulder],
    [7, 0, 0, materials.asphalt],
    [0.09, -3.1, 0.01, materials.paint],
    [0.09, 3.1, 0.01, materials.paint],
  ] satisfies [number, number, number, THREE.MeshStandardMaterial][];

  return layers.map(([widthM, offsetM, heightM, material]) => {
    const mesh = new THREE.Mesh(
      roadGeometry(roads.map((road) => sampleRoad(road, widthM, offsetM))),
      material,
    );

    mesh.position.y = heightM;
    mesh.receiveShadow = true;

    return mesh;
  });
}

/**
 * The ridden road with posts and waymarks, plus the world's side roads off the ridden path
 * (ADR-033 step 3) as plain road in four merged meshes.
 */
export function createRoadSystem(sideRoads: readonly EngineRoute[] = []): RenderSystem {
  const root = new THREE.Group();
  // Fun-mode item boxes float over this road and follow its lifecycle (spec E9-01).
  const itemBoxes = createItemBoxSystem();

  return {
    id: "road",
    order: 20,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This system installs its objects into the owned Three scene.
    init(context) {
      const asphalt = new THREE.MeshStandardMaterial({ color: 0x38444a, roughness: 0.95 });
      const paint = new THREE.MeshStandardMaterial({ color: 0xf0eacb, roughness: 0.8 });
      const shoulder = new THREE.MeshStandardMaterial({ color: 0xb9ae8a, roughness: 1 });
      const materials = { shoulder, asphalt, paint };

      root.add(...roadLayers([context.route], materials));

      if (sideRoads.length > 0) root.add(...roadLayers(sideRoads, materials));

      root.add(roadsidePosts(context.route, paint), createWaymarks(context.route));
      context.scene.add(root);
      itemBoxes.init(context);
    },
    update(frame) {
      itemBoxes.update(frame);
    },
    setQuality() {},
    dispose() {
      itemBoxes.dispose();
      disposeObject(root);
    },
  };
}
