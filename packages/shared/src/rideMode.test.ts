import { expect, it } from "vitest";

import { DEFAULT_RIDE_MODE, RIDE_MODE_IDS, RIDE_MODES } from "./rideMode.js";

it("lists every mode exactly once with the default first", () => {
  expect(RIDE_MODE_IDS[0]).toBe(DEFAULT_RIDE_MODE);
  expect([...RIDE_MODE_IDS].toSorted()).toEqual(Object.keys(RIDE_MODES).toSorted());
});

it("keeps the default mode recordable with progress", () => {
  expect(RIDE_MODES[DEFAULT_RIDE_MODE]).toEqual({
    recordable: true,
    progress: true,
    trainer: "simulation",
  });
});

it("fun mode yields neither recordings nor progress and keeps the simulation trainer path", () => {
  expect(RIDE_MODES.fun).toEqual({ recordable: false, progress: false, trainer: "simulation" });
});
