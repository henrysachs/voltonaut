/* oxlint-disable typescript/prefer-readonly-parameter-types -- Three's scene graph objects are mutable by contract; these helpers only traverse them. */
import { NIGHT_CITY, createRoute } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createNightCityScenery } from "./biomeScenery.js";
import { BLOOM_THRESHOLD } from "./bloom.js";
import { createLandscapePlan } from "./landscape-plan.js";
import { createLampLight, luminanceOf } from "./nightCityLights.js";
import { ROAD_SAMPLE_SPACING_M } from "./road-plan.js";

it("lamp light brightens the asphalt under each lamp and leaves the gaps between them dark", () => {
  const route = createRoute(NIGHT_CITY);
  const lampM = 400;
  const light = createLampLight(route, [{ routeDistanceM: lampM, side: 1 }]);
  const colors = light.geometry.getAttribute("color");
  const under = Math.round(lampM / ROAD_SAMPLE_SPACING_M);
  const twentyMetresOn = Math.round((lampM + 20) / ROAD_SAMPLE_SPACING_M);
  const underRight = colors.getX(under * 2 + 1);
  const underLeft = colors.getX(under * 2);

  expect(underRight).toBeGreaterThan(0.1);
  // Well below the bloom threshold: lamp light brightens the lane but never makes it flare.
  expect(underRight).toBeLessThan(BLOOM_THRESHOLD / 2);
  expect(underLeft).toBeGreaterThan(0);
  expect(underLeft).toBeLessThan(underRight);
  expect(colors.getX(twentyMetresOn * 2 + 1)).toBe(0);
  light.geometry.dispose();
});

it("every neon item glows through the bloom, whatever its hue", () => {
  const route = createRoute(NIGHT_CITY);
  const scenery = createNightCityScenery(createLandscapePlan(route, [route], 42, false));
  const glowing = neonLuminances(scenery);

  expect(glowing.length).toBeGreaterThan(100);
  expect(Math.min(...glowing)).toBeGreaterThan(BLOOM_THRESHOLD);
});

function neonLuminances(root: THREE.Object3D): readonly number[] {
  const luminances: number[] = [];
  const color = new THREE.Color();

  root.traverse((object) => {
    if (
      object instanceof THREE.InstancedMesh &&
      object.material instanceof THREE.MeshBasicMaterial
    ) {
      for (let index = 0; index < object.count; index += 1) {
        object.getColorAt(index, color);
        luminances.push(luminanceOf(color));
      }
    }
  });

  return luminances;
}
