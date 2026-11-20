import { describe, expect, it } from "vitest";

import {
  GEAR_RATIOS,
  GEAR_PRESETS,
  physicalRatioFor,
  START_GEAR_INDEX,
  ZWIFT_LIKE_24_PRESET,
} from "./presets.js";
import { MAX_GEAR_INDEX, MIN_GEAR_INDEX } from "./gears.js";

describe("zwift-like-24 preset", () => {
  it("has 24 entries and clamps to the verified anchors at gears 1, 14 and 24", () => {
    expect(GEAR_RATIOS.length).toBe(24);
    expect(GEAR_RATIOS[0]).toBe(0.75);
    expect(GEAR_RATIOS[13]).toBe(2.82);
    expect(GEAR_RATIOS[23]).toBe(5.49);
  });

  it("matches the docs/03 section 3 table spot checks", () => {
    expect(GEAR_RATIOS[4]).toBe(1.13);
    expect(GEAR_RATIOS[10]).toBe(2.08);
    expect(GEAR_RATIOS[18]).toBe(3.93);
  });

  it("rises strictly from gear 1 to gear 24", () => {
    for (let index = 1; index < GEAR_RATIOS.length; index += 1) {
      const previous = GEAR_RATIOS[index - 1];
      const current = GEAR_RATIOS[index];

      expect(current).toBeGreaterThan(previous);
    }
  });

  it("reproduces the 90 rpm table speeds for the anchors (2.105 m wheel)", () => {
    expect(GEAR_RATIOS.at(0)).toBeCloseTo(8.5 / ((90 / 60) * 2.105 * 3.6), 2);
    expect(GEAR_RATIOS.at(13)).toBeCloseTo(32.1 / ((90 / 60) * 2.105 * 3.6), 2);
    expect(GEAR_RATIOS.at(23)).toBeCloseTo(62.4 / ((90 / 60) * 2.105 * 3.6), 2);
  });

  it("starts in gear 12 (one-based) by default", () => {
    expect(START_GEAR_INDEX).toBe(11);
    expect(START_GEAR_INDEX).toBeGreaterThanOrEqual(MIN_GEAR_INDEX);
    expect(START_GEAR_INDEX).toBeLessThanOrEqual(MAX_GEAR_INDEX);
  });

  it("registers the preset under its id and maps the physical ratio", () => {
    expect(GEAR_PRESETS["zwift-like-24"]).toBe(ZWIFT_LIKE_24_PRESET);
    expect(physicalRatioFor(42, 14)).toBe(3);
  });
});
