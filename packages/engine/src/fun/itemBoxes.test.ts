import { expect, it } from "vitest";

import { FLAT_LOOP } from "../elevation/data/flat-loop.js";
import { KOM_CLIMB } from "../elevation/data/kom-climb.js";
import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute, type SegmentKind } from "../elevation/route.js";
import { planItemBoxes } from "./itemBoxes.js";

it("places the first box at 300 m and then one every 800 m", () => {
  expect(planItemBoxes(createRoute(FLAT_LOOP))).toEqual([300, 1100, 1900, 2700, 3500, 4300]);
  expect(planItemBoxes(createRoute(KOM_CLIMB))).toEqual([300, 1100, 1900]);
});

it("moves a box inside a sprint or KOM segment to the segment end", () => {
  // TEST_LOOP: sprint 2000–2500, KOM 5000–5600; the 5100 m box moves to 5600 m.
  expect(planItemBoxes(createRoute(TEST_LOOP))).toEqual([
    300, 1100, 1900, 2700, 3500, 4300, 5600, 5900, 6700, 7500, 8300, 9100, 9900,
  ]);
});

it("yields the same boxes for the same route", () => {
  expect(planItemBoxes(createRoute(TEST_LOOP))).toEqual(planItemBoxes(createRoute(TEST_LOOP)));
});

function boxesFor(
  lengthM: number,
  segments: readonly (readonly [SegmentKind, number, number])[],
): readonly number[] {
  return planItemBoxes({
    lengthM,
    segments: segments.map(([kind, startM, endM], index) => ({
      id: `s${index}`,
      name: "S",
      kind,
      startM,
      endM,
    })),
  });
}

it("treats segment start as inside and segment end as outside", () => {
  expect(boxesFor(2000, [["sprint", 1100, 1500]])).toEqual([300, 1500, 1900]);
  expect(boxesFor(2000, [["kom", 900, 1100]])).toEqual([300, 1100, 1900]);
});

it("ignores lap segments", () => {
  expect(boxesFor(2000, [["lap", 0, 2000]])).toEqual([300, 1100, 1900]);
});

it("merges several boxes inside one long segment into one at its end", () => {
  expect(boxesFor(4000, [["kom", 1000, 3000]])).toEqual([300, 3000, 3500]);
});

it("places no box at or beyond the route length", () => {
  expect(boxesFor(1100, [])).toEqual([300]);
  expect(boxesFor(1100.5, [])).toEqual([300, 1100]);
});
