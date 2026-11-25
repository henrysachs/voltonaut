import { createEngine, createRoute, planItemBoxes, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE, type RideMode } from "@voltonaut/shared";
import * as THREE from "three";
import { expect, it } from "vitest";

import { DEFAULT_ENVIRONMENT_SETTINGS, environmentAt } from "./environment.js";
import { createItemBoxSystem } from "./itemBoxes.js";
import { createRoadSystem } from "./road.js";
import { createScheduler } from "./scheduler.js";

const route = createRoute(TEST_LOOP);
const FIRST_BOX_M = 300;

const env = environmentAt(
  DEFAULT_ENVIRONMENT_SETTINGS.seed,
  DEFAULT_ENVIRONMENT_SETTINGS.startTimeS,
  DEFAULT_ENVIRONMENT_SETTINGS.script,
);

function frameIn(mode: RideMode) {
  const ride = createEngine({ route, profile: DEFAULT_RIDER_PROFILE, mode }).snapshot();

  return { ride, dtS: 0.05, alpha: 1, env };
}

function mountedBoxes() {
  const scene = new THREE.Scene();
  const scheduler = createScheduler([createItemBoxSystem()], { scene, route });
  const mesh = scene.getObjectByName("item-boxes");

  if (mesh instanceof THREE.InstancedMesh) return { scheduler, mesh };

  throw new Error("item boxes must be instanced");
}

function firstBoxPosition(): THREE.Vector3 {
  const matrix = new THREE.Matrix4();

  mountedBoxes().mesh.getMatrixAt(0, matrix);

  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

it("draws one instanced box per planned position in a single mesh", () => {
  expect(planItemBoxes(route)[0]).toBe(FIRST_BOX_M);
  expect(mountedBoxes().mesh.count).toBe(planItemBoxes(route).length);
});

it("shows the boxes only in fun mode", () => {
  const { scheduler, mesh } = mountedBoxes();

  scheduler.update(frameIn("normal"));
  expect(mesh.visible).toBe(false);
  scheduler.update(frameIn("fun"));
  expect(mesh.visible).toBe(true);
});

it("floats each box above the road at its planned distance", () => {
  const road = route.worldPos(FIRST_BOX_M);
  const position = firstBoxPosition();

  expect(position.x).toBeCloseTo(road.x, 2);
  expect(position.y - road.y).toBeCloseTo(1.4, 2);
  expect(position.z).toBeCloseTo(road.z, 2);
});

it("is mounted, updated and released by the road system", () => {
  const scene = new THREE.Scene();
  const scheduler = createScheduler([createRoadSystem()], { scene, route });

  scheduler.update(frameIn("fun"));
  expect(scene.getObjectByName("item-boxes")?.visible).toBe(true);
  scheduler.dispose();
  expect(scene.getObjectByName("item-boxes")).toBeUndefined();
});
