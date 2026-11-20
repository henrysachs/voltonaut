import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createRider } from "../avatar/rider.js";
import { createRideCamera } from "./camera.js";
import { createEnvironmentSystem } from "./environment.js";
import { createRoadSystem, sampleRoad } from "./road.js";
import { createScheduler } from "./scheduler.js";

const route = createRoute(TEST_LOOP);
const snapshot = createEngine({ route, profile: DEFAULT_RIDER_PROFILE }).snapshot();

interface DisposalEvents {
  readonly addEventListener: (type: "dispose", listener: () => void) => void;
}

it("keeps the follow camera near the rider even with accelerated snapshot translation", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const rideCamera = createRideCamera(camera);

  rideCamera.system.init({ scene, route });

  for (let frame = 0; frame < 60; frame += 1) {
    const ride = { ...snapshot, headingRad: 0, worldPos: { x: frame * 4, y: 100, z: 0 } };

    rideCamera.system.update({ ride, dtS: 1 / 60, alpha: 1 });
    expect(camera.position.distanceTo(new THREE.Vector3(ride.worldPos.x, 100, 0))).toBeLessThan(7);
  }
});

it("samples the public engine centerline, preserves width and closes the road", () => {
  const samples = sampleRoad(route, 7);

  for (const [index, sample] of samples.entries()) {
    const position = route.worldPos((index / (samples.length - 1)) * route.lengthM);

    expect((sample.left.x + sample.right.x) / 2).toBeCloseTo(position.x);
    expect((sample.left.z + sample.right.z) / 2).toBeCloseTo(position.z);
    expect(sample.left.y).toBeCloseTo(position.y + 0.025);
    expect(Math.hypot(sample.left.x - sample.right.x, sample.left.z - sample.right.z)).toBeCloseTo(
      7,
    );
  }

  expect(samples[0]).toEqual(samples.at(-1));
});

it("uses the actual snapshot pose and cadence, changes camera, then releases every mesh", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const rider = createRider(2.105);
  const rideCamera = createRideCamera(camera);

  const scheduler = createScheduler(
    [rideCamera.system, createRoadSystem(), rider.system, createEnvironmentSystem()],
    { scene, route },
  );

  const next = Object.freeze({
    ...snapshot,
    tS: 1,
    cadenceRpm: 90,
    distanceM: 10,
    headingRad: 1.2,
    worldPos: Object.freeze({ x: 10, y: 20, z: 30 }),
  });

  scheduler.update({ ride: snapshot, dtS: 0, alpha: 1 });
  scheduler.update({ ride: next, dtS: 0.05, alpha: 1 });
  expect(rider.position()).toEqual({ x: 10, y: 20.04, z: 30 });
  expect(rider.headingRad()).toBe(1.2);
  expect(rider.crankRad()).toBeCloseTo(Math.PI * 3);
  expect(rideCamera.mode()).toBe("chase");
  const chase = camera.position.clone();

  rideCamera.toggle();
  scheduler.update({ ride: next, dtS: 0.1, alpha: 1 });
  expect(rideCamera.mode()).toBe("overview");
  expect(camera.position.distanceTo(chase)).toBeGreaterThan(1);
  rideCamera.toggle();
  expect(rideCamera.mode()).toBe("chase");
  scheduler.setQuality("low");
  scheduler.setQuality("high");
  expectDisposal(scene, scheduler.dispose);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test observes disposal events on the real mutable Three scene graph.
function expectDisposal(scene: Readonly<THREE.Scene>, dispose: () => void): void {
  let geometryDisposals = 0;
  let materialDisposals = 0;
  const geometries = new Set<DisposalEvents>();
  const materials = new Set<DisposalEvents>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable Object3D contract.
  scene.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.geometry instanceof THREE.BufferGeometry &&
      object.material instanceof THREE.Material
    ) {
      geometries.add(object.geometry);
      materials.add(object.material);
    }
  });

  const onGeometryDisposed = (): void => {
    geometryDisposals += 1;
  };

  const onMaterialDisposed = (): void => {
    materialDisposals += 1;
  };

  for (const geometry of geometries) {
    geometry.addEventListener("dispose", onGeometryDisposed);
  }

  for (const material of materials) {
    material.addEventListener("dispose", onMaterialDisposed);
  }

  dispose();
  expect(scene.children).toHaveLength(0);
  expect(geometryDisposals).toBe(geometries.size);
  expect(materialDisposals).toBe(materials.size);
  expect(geometries.size).toBeGreaterThan(5);
}
