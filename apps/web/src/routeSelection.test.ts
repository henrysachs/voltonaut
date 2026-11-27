import { expect, it } from "vitest";

import { selectRouteFromUrl } from "./routeSelection.js";

it("records the voltonaut tour in its world (ADR-033 §7)", () => {
  expect(selectRouteFromUrl(new URLSearchParams("route=voltonaut-tour")).worldPath).toEqual({
    worldId: "voltonaut",
    worldRevision: "2",
    pathId: "voltonaut-tour",
  });
});

it("records the vineyard path in revision 2 of voltonaut (#146)", () => {
  const selection = selectRouteFromUrl(new URLSearchParams("route=voltonaut-vineyard"));

  expect(selection.routeId).toBe("voltonaut-vineyard");
  expect(selection.worldPath).toEqual({
    worldId: "voltonaut",
    worldRevision: "2",
    pathId: "voltonaut-vineyard",
  });
  expect(selection.environment).toEqual({
    seed: 37,
    startTimeS: 17.5 * 60 * 60,
    script: [{ startS: 0, weather: "clear" }],
  });
});

it("falls back to the test loop for an invalid route value", () => {
  const selection = selectRouteFromUrl(new URLSearchParams("route=voltonaut-vineyard-2"));

  expect(selection.worldPath.pathId).toBe("test-loop");
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
