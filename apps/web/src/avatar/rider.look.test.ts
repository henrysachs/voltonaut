import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import * as THREE from "three";
import { expect, it } from "vitest";

import { DEFAULT_ENVIRONMENT_SETTINGS, environmentAt } from "../world/environment.js";
import { createScheduler } from "../world/scheduler.js";
import { createRider } from "./rider.js";

const route = createRoute(TEST_LOOP);
const snapshot = createEngine({ route, profile: DEFAULT_RIDER_PROFILE }).snapshot();

const env = environmentAt(
  DEFAULT_ENVIRONMENT_SETTINGS.seed,
  DEFAULT_ENVIRONMENT_SETTINGS.startTimeS,
  DEFAULT_ENVIRONMENT_SETTINGS.script,
);

const STRIPE = {
  ...DEFAULT_AVATAR_CONFIG,
  rider: { ...DEFAULT_AVATAR_CONFIG.rider, jerseyId: "jersey.stripe", helmetColor: "#ec6b48" },
};

/** Colour of the rider's helmet shell, the only physical material on the skinned body. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph is mutable; the helper only reads it.
function wornHelmetHex(scene: THREE.Scene): string | undefined {
  for (const object of scene.getObjectsByProperty("isSkinnedMesh", true)) {
    if (
      object instanceof THREE.SkinnedMesh &&
      object.material instanceof THREE.MeshPhysicalMaterial
    )
      return `#${object.material.color.getHexString()}`;
  }

  return undefined;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph is mutable; the helper only reads it.
function skinnedMeshes(scene: THREE.Scene): number {
  return scene.getObjectsByProperty("isSkinnedMesh", true).length;
}

it("keeps the rider body out of the first frame even when a look arrives first", () => {
  const scene = new THREE.Scene();
  const rider = createRider(2.105);
  const scheduler = createScheduler([rider.system], { scene, route });

  rider.setLook(STRIPE);
  scheduler.update({ ride: snapshot, dtS: 0, alpha: 1, env });

  expect(skinnedMeshes(scene)).toBe(0);
  // No body, no look: the diagnostics must not claim the default kit is shown before the body is.
  expect(rider.look()).toBeUndefined();

  scheduler.update({ ride: snapshot, dtS: 0.05, alpha: 1, env });

  expect(skinnedMeshes(scene)).toBeGreaterThan(0);
  expect(rider.look()).toEqual(STRIPE);
  expect(wornHelmetHex(scene)).toBe(STRIPE.rider.helmetColor);
  scheduler.dispose();
});

/** Rider bodies built and kit rebuilds of a built body (each adds a new mesh set). */
interface BuildCounts {
  bodies: number;
  rebuilds: number;
}

/** Counts builds below the ride's rider root through Three's scene-graph events. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's scene graph is mutable; listeners only count.
function countBuilds(scene: THREE.Scene): Readonly<BuildCounts> {
  const counts: BuildCounts = { bodies: 0, rebuilds: 0 };
  const model = scene.getObjectByName("rider-root")?.children[0];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three's event hands over its mutable child.
  model?.addEventListener("childadded", ({ child }) => {
    if (child.name !== "rider") return;
    counts.bodies += 1;
    child.addEventListener("childadded", () => {
      counts.rebuilds += 1;
    });
  });

  return counts;
}

it("builds the deferred body once, directly in a look that arrived before it", () => {
  const scene = new THREE.Scene();
  const rider = createRider(2.105);
  const scheduler = createScheduler([rider.system], { scene, route });
  const counts = countBuilds(scene);

  // The ride's order: the server look arrives, then frames 1, 2 and 3.
  rider.setLook(STRIPE);
  scheduler.update({ ride: snapshot, dtS: 0, alpha: 1, env });
  scheduler.update({ ride: snapshot, dtS: 0.05, alpha: 1, env });
  scheduler.update({ ride: snapshot, dtS: 0.1, alpha: 1, env });

  expect(counts).toEqual({ bodies: 1, rebuilds: 0 });
  expect(rider.look()).toEqual(STRIPE);
  expect(wornHelmetHex(scene)).toBe(STRIPE.rider.helmetColor);
  scheduler.dispose();
});

it("wears the default look once the deferred body exists when no look was requested", () => {
  const scene = new THREE.Scene();
  const rider = createRider(2.105);
  const scheduler = createScheduler([rider.system], { scene, route });

  scheduler.update({ ride: snapshot, dtS: 0, alpha: 1, env });
  expect(rider.look()).toBeUndefined();

  scheduler.update({ ride: snapshot, dtS: 0.05, alpha: 1, env });
  expect(skinnedMeshes(scene)).toBeGreaterThan(0);
  expect(rider.look()).toEqual(DEFAULT_AVATAR_CONFIG);
  scheduler.dispose();
});
