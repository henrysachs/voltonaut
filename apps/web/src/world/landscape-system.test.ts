import { ALPINE_PASS, COAST_LOOP, createRoute, NIGHT_CITY, TEST_LOOP } from "@voltonaut/engine";
import * as THREE from "three";
import { expect, it } from "vitest";

import { createLandscapeSystem } from "./landscape.js";
import { resolveRenderWorld } from "./render-world.js";
import { createScheduler } from "./scheduler.js";
import { PAIR } from "./testdata/pairWorld.js";

const route = createRoute(TEST_LOOP);

interface DisposalResource {
  readonly addEventListener: (type: "dispose", listener: () => void) => void;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test observes the real mutable Three scene graph.
function collectResources(scene: Readonly<THREE.Scene>): ReadonlySet<DisposalResource> {
  const resources = new Set<DisposalResource>();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene object contract.
  scene.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.geometry instanceof THREE.BufferGeometry &&
      object.material instanceof THREE.Material
    ) {
      resources.add(object.geometry);
      resources.add(object.material);
    }

    if (object instanceof THREE.InstancedMesh) {
      resources.add(object);
    }
  });

  return resources;
}

it("releases every shared geometry, material and instance buffer once without touching another owner", () => {
  const scene = new THREE.Scene();
  const unrelated = new THREE.Group();

  scene.add(unrelated);

  const scheduler = createScheduler([createLandscapeSystem(resolveRenderWorld(route.id))], {
    scene,
    route,
  });

  const resources = collectResources(scene);

  const counts = Array.from(resources, (resource) => {
    let count = 0;

    resource.addEventListener("dispose", () => {
      count += 1;
    });

    return () => count;
  });

  expect(resources.size).toBeGreaterThan(100);
  scheduler.dispose();
  scheduler.dispose();
  expect(counts.map((count) => count())).toEqual(counts.map(() => 1));
  expect(scene.children).toEqual([unrelated]);
});

it.each([TEST_LOOP, COAST_LOOP, ALPINE_PASS, NIGHT_CITY])(
  "the landscape system builds $id from its route and disposes it",
  (data) => {
    const scene = new THREE.Scene();

    const scheduler = createScheduler([createLandscapeSystem(resolveRenderWorld(data.id))], {
      scene,
      route: createRoute(data),
    });

    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBeInstanceOf(THREE.Group);
    scheduler.dispose();
    expect(scene.children).toHaveLength(0);
  },
);

function tourRoad(): typeof route {
  return PAIR.roads[0] ?? route;
}

it("dresses every region of a connected world and blends the terrain between them", () => {
  const scene = new THREE.Scene();

  const scheduler = createScheduler([createLandscapeSystem(PAIR)], {
    scene,
    route: tourRoad(),
  });

  expect(PAIR.regions.map((region) => [region.id, region.biome.kind, region.home.id])).toEqual([
    ["woods", "forest", "pair-woods"],
    ["city", "night-city", "pair-city"],
  ]);
  expect(scene.getObjectByName("forest-and-rocks")).toBeInstanceOf(THREE.Group);
  expect(scene.getObjectByName("biome-night-city")).toBeInstanceOf(THREE.Group);
  expect(scene.getObjectByName("lake-water")?.parent?.position.x).toBeLessThan(800);
  scheduler.dispose();
  expect(scene.children).toHaveLength(0);
});
