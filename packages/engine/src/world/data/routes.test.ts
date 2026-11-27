import { expect, it } from "vitest";

import { TEST_ROUTES } from "../../elevation/data/index.js";

import { WORLD_REGISTRY, WORLDS } from "./index.js";
import { parseRouteId, registeredRoute, ROUTE_REGISTRY, routeWorldPath } from "./routes.js";

const ROUTE_IDS = Object.keys(ROUTE_REGISTRY).flatMap((id) => {
  const routeId = parseRouteId(id);

  return routeId === undefined ? [] : [routeId];
});

it("registers every path of every shipped world, in world order", () => {
  expect(Object.keys(ROUTE_REGISTRY)).toEqual(
    WORLDS.flatMap((world) => world.routes.map((route) => route.id)),
  );
  expect(ROUTE_IDS).toEqual(Object.keys(ROUTE_REGISTRY));
});

it("keys worlds by their own id", () => {
  for (const [worldId, world] of Object.entries(WORLD_REGISTRY)) expect(world.id).toBe(worldId);
});

it("resolves each route in the world it names to the shipped route data", () => {
  for (const routeId of ROUTE_IDS) {
    expect(registeredRoute(routeId)).toBe(TEST_ROUTES[routeId]);
    expect(registeredRoute(routeId)?.id).toBe(routeId);
  }
});

it("pins the replay policy of every shipped route (ADR-016, ADR-033 §7–8)", () => {
  expect(
    ROUTE_IDS.map((routeId) => {
      const { worldId, replay } = ROUTE_REGISTRY[routeId];

      return [routeId, worldId, replay.worldRevision, replay.legacyRouteRevision];
    }),
  ).toEqual([
    ["flat-loop", "flat-loop", "1", "1"],
    ["test-loop", "test-loop", "1", "1"],
    ["kom-climb", "kom-climb", "1", "1"],
    ["coast-loop", "coast-loop", "1", "1"],
    ["alpine-pass", "alpine-pass", "1", "1"],
    ["night-city", "night-city", "1", "1"],
    ["voltonaut-tour", "voltonaut", "1", undefined],
    ["voltonaut-forest", "voltonaut", "1", undefined],
    ["voltonaut-coast", "voltonaut", "1", undefined],
    ["voltonaut-night-city", "voltonaut", "1", undefined],
    ["felsental", "felsental", "1", undefined],
  ]);
});

it("replays the current revision of every world, so new rides stay scorable", () => {
  for (const routeId of ROUTE_IDS) {
    const { worldId, replay } = ROUTE_REGISTRY[routeId];

    expect(replay.worldRevision).toBe(WORLD_REGISTRY[worldId].revision);
  }
});

it("records new rides on the route's own world and revision (ADR-033 §7)", () => {
  expect(routeWorldPath("test-loop")).toEqual({
    worldId: "test-loop",
    worldRevision: "1",
    pathId: "test-loop",
  });
  expect(routeWorldPath("voltonaut-tour")).toEqual({
    worldId: "voltonaut",
    worldRevision: "1",
    pathId: "voltonaut-tour",
  });
});

it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "voltonaut", "", "missing"])(
  "parses %o as no route id",
  (value) => {
    expect(parseRouteId(value)).toBeUndefined();
  },
);

it("parses registered ids unchanged", () => {
  expect(parseRouteId("coast-loop")).toBe("coast-loop");
  expect(parseRouteId("voltonaut-tour")).toBe("voltonaut-tour");
});
