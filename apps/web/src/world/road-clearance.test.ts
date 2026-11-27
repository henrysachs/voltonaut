import { createRoute, KOM_CLIMB, TEST_ROUTES, WORLDS, type EngineRoute } from "@voltonaut/engine";
import { beforeAll, describe, expect, it } from "vitest";

import { heightAt, type Heightfield } from "./heightfield.js";
import { planLake } from "./lake-plan.js";
import { roadClearance } from "./road-clearance.js";
import { roadSampleDistances, SHOULDER_WIDTH_M } from "./road-plan.js";
import { hairpinRoad } from "./road-test-routes.js";
import { renderWorldOf, type RenderWorld } from "./render-world.js";
import { planTerrain } from "./terrain-plan.js";
import { planWorldLandscape } from "./world-landscape.js";

/** Smallest clearance the AK4 gate accepts: the shoulder is drawn 0.005 m above the profile. */
const MIN_CLEARANCE_M = 0.05;

interface ShippedRoute {
  readonly id: string;
  readonly route: EngineRoute;
  readonly world: RenderWorld;
}

const worldViews: readonly RenderWorld[] = WORLDS.map((world) => renderWorldOf(world));

const shipped: readonly ShippedRoute[] = worldViews.flatMap((view) =>
  view.roads.map((route): ShippedRoute => ({ id: route.id, route, world: view })),
);

const terrainOfWorld = new Map<RenderWorld, Heightfield>();

/** The world raster as drawn, planned once per world. */
function drawnTerrain(world: RenderWorld): Heightfield {
  const known = terrainOfWorld.get(world);

  if (known !== undefined) return known;

  const field = planWorldLandscape(world).landscape.terrain;

  terrainOfWorld.set(world, field);

  return field;
}

function shippedRoute(id: string): ShippedRoute {
  const found = shipped.find((entry) => entry.id === id);

  if (found === undefined) throw new Error(`${id} is not a shipped route`);

  return found;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    return state / 4_294_967_296;
  };
}

/** Dense random probes inside the road band; the exact check must never miss a lower one. */
function sampledMinimum(field: Heightfield, route: EngineRoute, count: number): number {
  const random = seededRandom(7);
  const distances = roadSampleDistances(route);
  let lowest = Number.POSITIVE_INFINITY;

  for (let probe = 0; probe < count; probe += 1) {
    const index = Math.floor(random() * (distances.length - 1));
    const fromM = distances[index] ?? 0;
    const distanceM = fromM + random() * ((distances[index + 1] ?? fromM) - fromM);
    const lateralM = (random() - 0.5) * SHOULDER_WIDTH_M * 0.999;
    const position = route.worldPos(distanceM);
    const heading = route.headingRad(distanceM);
    const x = position.x - Math.sin(heading) * lateralM;
    const z = position.z + Math.cos(heading) * lateralM;

    lowest = Math.min(lowest, position.y - heightAt(field, x, z));
  }

  return lowest;
}

/** The climb raster with the point (1048, 0) on the centerline raised by 1 m. */
function withRaisedPoint(field: Heightfield): Heightfield {
  const tiles = field.tiles.map((tile) => {
    const target = tile.originX === 1024 && tile.originZ === 0;

    return Object.assign({}, tile, {
      heightsM: tile.heightsM.map((y, index) => y + Number(target && index === 3)),
    });
  });

  return Object.assign({}, field, { tiles });
}

/** Raster clearance of the route in its world, as the landscape draws it. */
function clearanceOfShipped(id: string): number {
  const { route, world } = shippedRoute(id);

  return roadClearance(drawnTerrain(world), route).minClearanceM;
}

describe("road clearance (AK4)", () => {
  it("covers every shipped route", () => {
    expect(shipped.map((entry) => entry.route.id).toSorted()).toEqual(
      Object.keys(TEST_ROUTES).toSorted(),
    );
  });

  it("keeps the terrain under a tight climbing hairpin", () => {
    const hairpin = hairpinRoad(12, 6);
    const field = planTerrain([hairpin], [planLake(hairpin)], 42).field;

    expect(roadClearance(field, hairpin).minClearanceM).toBeGreaterThanOrEqual(MIN_CLEARANCE_M);
  });

  it("finds a minimum at least as low as dense random probes", () => {
    const { route, world } = shippedRoute("test-loop");
    const field = drawnTerrain(world);
    const exact = roadClearance(field, route).minClearanceM;

    expect(exact).toBeLessThanOrEqual(sampledMinimum(field, route, 20_000) + 1e-9);
  });

  it("reports a raised raster point under the road with its position", () => {
    const route = createRoute(KOM_CLIMB);

    const raised = roadClearance(
      withRaisedPoint(planTerrain([route], [planLake(route)], 42).field),
      route,
    );

    expect(raised.minClearanceM).toBeCloseTo(-0.94, 9);
    expect({ x: raised.x, z: raised.z }).toEqual({ x: 1048, z: 0 });
  });
});

describe.each(worldViews.map((view, index) => [WORLDS[index]?.id, view] as const))(
  "road clearance in world %s (AK4)",
  (_worldId, view) => {
    // One raster per world, planned before its routes are checked against it.
    beforeAll(() => {
      drawnTerrain(view);
    });

    it.each(view.roads.map((road) => road.id))(
      "keeps the terrain under every road band of %s",
      (id) => {
        expect(clearanceOfShipped(id)).toBeGreaterThanOrEqual(MIN_CLEARANCE_M);
      },
    );
  },
);
