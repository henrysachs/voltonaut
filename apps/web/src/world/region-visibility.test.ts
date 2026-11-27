import { createRoute, type EngineRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { DressingGroup } from "./dressing-group.js";
import { planWorldLandscape } from "./world-landscape.js";
import { regionDressings, showInView, type RegionDressing } from "./region-dressing.js";
import { regionInView, VIEW_RANGE_M, type RegionBounds } from "./region-visibility.js";
import { renderWorldOf } from "./render-world.js";
import { pairWorld } from "./testdata/pairWorld.js";

const box: RegionBounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

function part(bounds: RegionBounds): RegionDressing {
  const object = new THREE.Mesh();

  return { group: new DressingGroup(), parts: [{ object, bounds }], lightForNight: () => {} };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The dressing holds mutable Three objects whose visibility the test reads.
function visibility(dressing: RegionDressing): boolean | undefined {
  return dressing.parts[0]?.object.visible;
}

it("sees a part from inside and up to the view range outside it", () => {
  expect(VIEW_RANGE_M).toBe(1500);
  expect(regionInView(box, 50, 50)).toBe(true);
  expect(regionInView(box, 100 + VIEW_RANGE_M, 50)).toBe(true);
  expect(regionInView(box, 100 + VIEW_RANGE_M + 1, 50)).toBe(false);
  expect(regionInView(box, 50, -VIEW_RANGE_M - 1)).toBe(false);
  expect(regionInView(box, -1000, -1000)).toBe(true);
  expect(regionInView(box, -1100, -1100)).toBe(false);
});

it("hides only the parts out of view in a world of several regions", () => {
  const near = part(box);
  const far = part({ minX: 9000, maxX: 9100, minZ: 0, maxZ: 100 });

  showInView([near, far], 50, 50);
  expect([visibility(near), visibility(far)]).toEqual([true, false]);
  showInView([near, far], 9050, 50);
  expect([visibility(near), visibility(far)]).toEqual([false, true]);
});

it("always shows the single region of a single-route world", () => {
  const only = part({ minX: 9000, maxX: 9100, minZ: 0, maxZ: 100 });

  showInView([only], 0, 0);
  expect(visibility(only)).toBe(true);
});

/** The pair 5 km apart: far enough for parts to leave view range on the tour. */
const farPair = pairWorld(5000);
const farView = renderWorldOf(farPair);
const dressings = regionDressings(farView, planWorldLandscape(farView).landscape.plans);

function tourRoute(): EngineRoute {
  const data = farPair.route("pair-tour");

  if (data === undefined) throw new Error("pair world has no tour");

  return createRoute(data);
}

/** Instance positions of a drawable, or its own position. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three objects expose their instance matrices as mutable members.
function groundPoints(object: THREE.Object3D): readonly THREE.Vector3[] {
  if (object instanceof THREE.InstancedMesh) {
    const matrix = new THREE.Matrix4();

    return Array.from({ length: object.count }, (_, index) => {
      object.getMatrixAt(index, matrix);

      return new THREE.Vector3().setFromMatrixPosition(matrix.premultiply(object.matrixWorld));
    });
  }

  return [new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)];
}

/** Hidden parts with something closer than the given distance to the rider, along the tour. */
function hiddenNear(withinM: number): readonly string[] {
  const tour = tourRoute();
  const found: string[] = [];

  for (let distanceM = 0; distanceM < tour.lengthM; distanceM += 50) {
    const at = tour.worldPos(distanceM);

    showInView(dressings, at.x, at.z);

    for (const { parts } of dressings) {
      for (const { object } of parts) {
        const near = groundPoints(object).some(
          // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three vectors are mutable value objects; the test only reads them.
          (point) => Math.hypot(point.x - at.x, point.z - at.z) < withinM,
        );

        if (!object.visible && near) found.push(`${object.name || object.type}@${distanceM}`);
      }
    }
  }

  return found;
}

/** Parts hidden at some point of the tour. */
function everHidden(): number {
  const tour = tourRoute();
  const hidden = new Set<THREE.Object3D>();

  for (let distanceM = 0; distanceM < tour.lengthM; distanceM += 50) {
    const at = tour.worldPos(distanceM);

    showInView(dressings, at.x, at.z);

    for (const { parts } of dressings) {
      for (const { object } of parts) if (!object.visible) hidden.add(object);
    }
  }

  return hidden.size;
}

it("never hides a part with anything within 1400 m of the rider along the tour", () => {
  expect(everHidden()).toBeGreaterThan(10);
  expect(hiddenNear(1400)).toEqual([]);
});

/** Lights anywhere in the dressing groups. */
function dressingLights(): readonly THREE.Object3D[] {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Dressing groups are mutable Three objects the test traverses.
  return dressings.flatMap(({ group }) => {
    const found: THREE.Object3D[] = [];

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene objects.
    group.traverse((object) => {
      if (object instanceof THREE.Light) found.push(object);
    });

    return found;
  });
}

it("keeps no light in the dressing of a world with several regions", () => {
  const lights = dressingLights();

  expect(lights).toEqual([]);
});
