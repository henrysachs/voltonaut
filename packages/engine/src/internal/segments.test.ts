import { expect, it } from "vitest";

import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute } from "../elevation/route.js";
import { GEAR_RATIOS, START_GEAR_INDEX } from "../gears/presets.js";
import { applySegments, crossedBoundaryM } from "./segments.js";
import { createRideState } from "./state.js";

it("counts a forward crossing with exclusive start and inclusive end", () => {
  expect(crossedBoundaryM(10, 20, 15, false)).toBe(true);
  expect(crossedBoundaryM(10, 20, 10, false)).toBe(false);
  expect(crossedBoundaryM(10, 20, 20, false)).toBe(true);
  expect(crossedBoundaryM(10, 20, 25, false)).toBe(false);
  expect(crossedBoundaryM(10, 10, 10, true)).toBe(false);
});

it("counts boundaries on both sides of a lap wrap", () => {
  expect(crossedBoundaryM(9990, 5, 9995, true)).toBe(true);
  expect(crossedBoundaryM(9990, 5, 3, true)).toBe(true);
  expect(crossedBoundaryM(9990, 5, 5, true)).toBe(true);
  expect(crossedBoundaryM(9990, 5, 9990, true)).toBe(false);
  expect(crossedBoundaryM(9990, 5, 6, true)).toBe(false);
  expect(crossedBoundaryM(9990, 5, 5000, true)).toBe(false);
});

it("never treats a backward step on a non-loop route as a wrap", () => {
  expect(crossedBoundaryM(20, 10, 15, false)).toBe(false);
  expect(crossedBoundaryM(20, 10, 5, false)).toBe(false);
});

function freshState() {
  return createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps: 0,
    routePosM: 0,
    mode: "normal",
    seed: 42,
  });
}

it("enters and exits a segment once and keeps other active segments", () => {
  const route = createRoute(TEST_LOOP);
  const state = freshState();

  state.activeSegments = ["other"];

  expect(applySegments(state, route, 1990, 2010, 1).map((event) => event.type)).toEqual([
    "segment.entered",
  ]);
  expect(applySegments(state, route, 2490, 2510, 2).map((event) => event.type)).toEqual([
    "segment.exited",
  ]);
  expect(state.activeSegments).toEqual(["other"]);
});
