import { ALPINE_PASS, COAST_LOOP, createRoute, NIGHT_CITY, TEST_LOOP } from "@voltonaut/engine";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { worldAtmosphere } from "./biome-atmosphere.js";
import { createLandscapeSystem } from "./landscape.js";
import { resolveRenderWorld } from "./render-world.js";
import { createScheduler, type Scheduler } from "./scheduler.js";
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

interface BuiltLandscape {
  readonly scene: THREE.Scene;
  readonly scheduler: Scheduler;
}

describe.each([TEST_LOOP, COAST_LOOP, ALPINE_PASS, NIGHT_CITY])(
  "the landscape system on $id",
  (data) => {
    // One build per route in its own hook, so the check below only reads and disposes it.
    let built: BuiltLandscape | undefined;

    beforeAll(() => {
      const scene = new THREE.Scene();

      const scheduler = createScheduler([createLandscapeSystem(resolveRenderWorld(data.id))], {
        scene,
        route: createRoute(data),
      });

      built = { scene, scheduler };
    });

    function landscape(): BuiltLandscape {
      if (built === undefined) throw new Error(`${data.id} landscape was not built`);

      return built;
    }

    it("builds from its route and disposes it", () => {
      const { scene, scheduler } = landscape();

      expect(scene.children).toHaveLength(1);
      expect(scene.children[0]).toBeInstanceOf(THREE.Group);
      scheduler.dispose();
      expect(scene.children).toHaveLength(0);
    });
  },
);

/** Lights the landscape system puts into a scene, as [type, colour, intensity]. */
function landscapeLights(routeId: string): readonly (readonly [string, string, number])[] {
  const scene = new THREE.Scene();
  const ridden = resolveRenderWorld(routeId);

  const scheduler = createScheduler([createLandscapeSystem(ridden)], {
    scene,
    route: ridden.roads[0] ?? route,
  });

  const lights: (readonly [string, string, number])[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three traversal supplies its mutable scene objects.
  scene.traverse((object) => {
    if (object instanceof THREE.Light)
      lights.push([object.type, object.color.getHexString(), object.intensity]);
  });
  scheduler.dispose();

  return lights;
}

it("lights the night city route with its blue glow", () => {
  expect(landscapeLights(NIGHT_CITY.id)).toEqual([["AmbientLight", "35405e", 1.1]]);
});

it("adds no light to the forest route", () => {
  expect(landscapeLights(TEST_LOOP.id)).toEqual([]);
});

// The connected world's dressing carries no light either (dressing-ground.test.ts).
it("keeps the night city glow out of the connected world's atmosphere", () => {
  const voltonaut = resolveRenderWorld("voltonaut-tour");

  expect(voltonaut.regions.map((region) => region.biome.kind)).toContain("night-city");
  expect(worldAtmosphere(voltonaut)).toEqual([]);
});

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
