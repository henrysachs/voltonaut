/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only traverse them. */
import { COAST_LOOP, NIGHT_CITY, createRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createCoastScenery, createNightCityScenery, nightLightsOf } from "./biomeScenery.js";
import { routeClearanceM, routeCorridorSamples, seededRandom } from "./biomeSceneryShared.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { BUILDING_CLEARANCE_M, NEON_HUES, planBuildings } from "./nightCityBuildings.js";
import { WINDOW_MATERIAL_NAME } from "./nightCityLights.js";
import { disposeObject } from "./resources.js";

it("night city builds a deterministic canyon of buildings that keeps off every road leg", () => {
  const route = createRoute(NIGHT_CITY);
  const plan = createLandscapePlan(route, [route], 42, false);
  const first = planBuildings(plan, seededRandom(151));
  const second = planBuildings(plan, seededRandom(151));
  // Metre samples, finer than the 10 m the planner uses: the 10 m grid may overstate a gap by
  // up to 0.7 m at 20 m (√(19.4² + 5²) ≈ 20), so the true distance must stay above 19 m.
  const roadSamples = routeCorridorSamples(route, 1);

  expect(first).toEqual(second);
  expect(first.buildings.length).toBeGreaterThan(600);
  expect(Math.min(...first.buildings.map((building) => building.heightM))).toBeLessThan(30);
  expect(Math.max(...first.buildings.map((building) => building.heightM))).toBeGreaterThan(110);

  for (const building of first.buildings) {
    expect(routeClearanceM(building.position, roadSamples)).toBeGreaterThan(
      BUILDING_CLEARANCE_M - 1,
    );
  }

  expect(first.tubes.length).toBeGreaterThan(50);
  expect(new Set(first.tubes.map((tube) => tube.hue))).toEqual(new Set(NEON_HUES));
});

it("night city lights fade with daylight and every texture is disposed", () => {
  const route = createRoute(NIGHT_CITY);
  const plan = createLandscapePlan(route, [route], 42, false);
  const scenery = createNightCityScenery(plan);
  const windows = windowMaterial(scenery);
  const lightForNight = nightLightsOf(scenery);

  lightForNight(1);

  const nightIntensity = windows.emissiveIntensity;

  lightForNight(0);
  expect(windows.emissiveIntensity).toBeLessThan(nightIntensity / 4);

  let disposedCount = 0;

  windows.emissiveMap?.addEventListener("dispose", () => {
    disposedCount += 1;
  });

  disposeObject(scenery);
  expect(disposedCount).toBe(1);
});

function windowMaterial(scenery: THREE.Object3D): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | undefined;

  scenery.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.MeshStandardMaterial &&
      object.material.name === WINDOW_MATERIAL_NAME
    ) {
      found = object.material;
    }
  });

  if (found === undefined) throw new Error("Missing window material");

  return found;
}

it("night lights leave every other biome's lamps alone", () => {
  const route = createRoute(COAST_LOOP);
  const coast = createCoastScenery(createLandscapePlan(route, [route], 42, true));
  const before = basicColors(coast);

  nightLightsOf(coast)(0);
  expect(basicColors(coast)).toEqual(before);
  expect(before.length).toBeGreaterThan(0);
});

function basicColors(root: THREE.Object3D): readonly string[] {
  const colors: string[] = [];

  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) {
      colors.push(object.material.color.getHexString());
    }
  });

  return colors;
}
