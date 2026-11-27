import { expect, it } from "vitest";

import { selectRouteFromUrl } from "./routeSelection.js";

it("records the voltonaut tour in its world (ADR-033 §7)", () => {
  expect(selectRouteFromUrl(new URLSearchParams("route=voltonaut-tour")).worldPath).toEqual({
    worldId: "voltonaut",
    worldRevision: "1",
    pathId: "voltonaut-tour",
  });
});

it("records Felsental in its own world (spec E10-16 AK3)", () => {
  expect(selectRouteFromUrl(new URLSearchParams("route=felsental")).worldPath).toEqual({
    worldId: "felsental",
    worldRevision: "1",
    pathId: "felsental",
  });
});

it("keeps single-route rides in their own world", () => {
  expect(selectRouteFromUrl(new URLSearchParams("route=night-city")).worldPath).toEqual({
    worldId: "night-city",
    worldRevision: "1",
    pathId: "night-city",
  });
  expect(selectRouteFromUrl(new URLSearchParams()).worldPath.pathId).toBe("test-loop");
});
