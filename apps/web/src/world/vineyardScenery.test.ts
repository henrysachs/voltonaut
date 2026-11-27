/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only traverse them. */
import { createRoute, VOLTONAUT_REVISION_2 } from "@voltonaut/engine";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { biomeObjects } from "./biome-landscape.js";
import { regionDressings, showInView } from "./region-dressing.js";
import { required, vineyardFixture } from "./testdata/vineyardWorld.js";

const { world, plans, plan, vineyard } = vineyardFixture();
const dressings = regionDressings(world, plans);
const tour = createRoute(required(VOLTONAUT_REVISION_2.route("voltonaut-tour")));

function instanced(objects: readonly THREE.Object3D[]): readonly THREE.InstancedMesh[] {
  return objects.filter((object) => object instanceof THREE.InstancedMesh);
}

/** Instance positions of the drawable parts that are hidden for a rider at the given point. */
function hiddenInstances(x: number, z: number): readonly THREE.Vector3[] {
  const matrix = new THREE.Matrix4();

  showInView(dressings, x, z);

  return dressings
    .flatMap(({ parts }) => parts.map(({ object }) => object))
    .filter((object) => !object.visible)
    .flatMap((object) => instanced([object]))
    .flatMap((mesh) =>
      Array.from({ length: mesh.count }, (_, index) => {
        mesh.getMatrixAt(index, matrix);

        return new THREE.Vector3().setFromMatrixPosition(matrix);
      }),
    );
}

describe("vineyard decor meshes", () => {
  const [group] = biomeObjects({ kind: "vineyard" }, plan);
  const meshes = instanced(group?.children ?? []);

  it("draws vines, cypresses and houses as four instanced meshes", () => {
    expect(group?.name).toBe("biome-vineyard");
    expect(meshes.map((mesh) => [mesh.name, mesh.count])).toEqual([
      ["vine-rows", vineyard.chords.length],
      ["cypresses", vineyard.cypresses.length],
      ["stone-houses", vineyard.houses.length],
      ["house-roofs", vineyard.houses.length],
    ]);
  });

  it("shapes cypresses as cones and houses as boxes", () => {
    expect(required(meshes[1]).geometry).toBeInstanceOf(THREE.ConeGeometry);
    expect(required(meshes[0]).geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(required(meshes[2]).geometry).toBeInstanceOf(THREE.BoxGeometry);
  });
});

describe("render distance of the vineyard dressing (spec E10-14 AK8)", () => {
  const rides = Array.from({ length: Math.floor(tour.lengthM / 100) }, (_, index) =>
    tour.worldPos(index * 100),
  );

  it("hides the vineyard far from it and shows it on the way in and out", () => {
    const vineyardParts = required(dressings[1]).parts;

    const visibleAt = rides.map(({ x, z }) => {
      showInView(dressings, x, z);

      return vineyardParts.some(({ object }) => object.visible);
    });

    expect(vineyardParts).toHaveLength(4);
    expect(visibleAt).toContain(true);
    expect(visibleAt).toContain(false);
  });

  it("never hides a part with an instance within 1400 m of the rider along the tour", () => {
    const nearestHiddenM = rides
      .flatMap(({ x, z }) =>
        hiddenInstances(x, z).map((point) => Math.hypot(point.x - x, point.z - z)),
      )
      .reduce((nearest, distanceM) => Math.min(nearest, distanceM), Number.POSITIVE_INFINITY);

    expect(nearestHiddenM).toBeGreaterThanOrEqual(1400);
  });
});
