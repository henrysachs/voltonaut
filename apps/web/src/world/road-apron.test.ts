import { ALPINE_PASS, createRoute, TEST_ROUTES } from "@voltonaut/engine";
import { beforeAll, describe, expect, it } from "vitest";

import { createLandscapePlan } from "./landscape-plan.js";
import { apronSamples, ROAD_APRON_DROP_M } from "./road-apron.js";
import { bandTriangles, ribbonTriangles } from "./road-band.js";
import { surfaceClearance } from "./surface-clearance.js";

const alpine = createRoute(ALPINE_PASS);

const ROUTE_IDS = Object.keys(TEST_ROUTES);
const clearanceByRoute = new Map<string, number>();

function measureApronClearance(id: string): number {
  const route = createRoute(TEST_ROUTES[id] ?? ALPINE_PASS);
  const plan = createLandscapePlan(route, [route], 42, false);

  return surfaceClearance(bandTriangles(route), ribbonTriangles(plan.apron)).minClearanceM;
}

/** Apron clearance under the drawn band of a shipped route; Infinity without an apron. Planned once per route. */
function apronClearance(id: string): number {
  const known = clearanceByRoute.get(id);

  if (known !== undefined) {
    return known;
  }

  const measured = measureApronClearance(id);

  clearanceByRoute.set(id, measured);

  return measured;
}

/** Drop of each left apron edge point under the road at its support point. */
function apronDrops(): readonly number[] {
  const samples = apronSamples(alpine);

  return samples.map(
    (sample, index) =>
      alpine.worldPos((index * alpine.lengthM) / (samples.length - 1)).y - sample.left.y,
  );
}

it("ships the apron rule for exactly the two alpine-biome routes (#138)", () => {
  expect(ROUTE_IDS.filter((id) => TEST_ROUTES[id]?.scenery === "alpine")).toEqual([
    "kom-climb",
    "alpine-pass",
  ]);
});

describe.each(ROUTE_IDS)("road apron on %s", (id) => {
  // Plan and measure once per route in its own hook, so no check carries the build.
  beforeAll(() => {
    apronClearance(id);
  });

  it("is drawn exactly when the route is alpine", () => {
    expect(Number.isFinite(apronClearance(id))).toBe(TEST_ROUTES[id]?.scenery === "alpine");
  });
});

it("keeps the kom-climb apron under its road band", () => {
  expect(apronClearance("kom-climb")).toBeGreaterThanOrEqual(0.05);
});

it("keeps the alpine apron under the drawn road band, also at the 90° corners (AK4)", () => {
  expect(apronClearance("alpine-pass")).toBeGreaterThanOrEqual(0.05);
});

it("lays the apron 0.3 m under the road except where another band lies above it", () => {
  const drops = apronDrops();

  expect(drops).toHaveLength(Math.ceil(alpine.lengthM / 2) + 1);
  expect(Math.min(...drops)).toBeCloseTo(ROAD_APRON_DROP_M, 9);
  expect(drops.filter((dropM) => dropM > ROAD_APRON_DROP_M + 1e-9).length).toBeLessThan(
    drops.length / 100,
  );
});
