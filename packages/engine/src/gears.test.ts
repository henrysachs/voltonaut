import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GEAR_COUNT, MAX_GEAR_INDEX, MIN_GEAR_INDEX, shiftGearIndex } from "./gears.js";

describe("shiftGearIndex", () => {
  it("defines the 24-gear range", () => {
    expect(GEAR_COUNT).toBe(24);
    expect(MAX_GEAR_INDEX).toBe(23);
    expect(MIN_GEAR_INDEX).toBe(0);
  });

  it("shifts up and down inside the gear range", () => {
    expect(shiftGearIndex(10, "up")).toBe(11);
    expect(shiftGearIndex(10, "down")).toBe(9);
  });

  it("does not shift below the first gear or above the last gear", () => {
    expect(shiftGearIndex(MIN_GEAR_INDEX, "down")).toBe(MIN_GEAR_INDEX);
    expect(shiftGearIndex(MAX_GEAR_INDEX, "up")).toBe(MAX_GEAR_INDEX);
  });

  it("keeps every shifted index inside the gear range", () => {
    const arbitraryIndex = fc.integer({ min: -10, max: 40 });
    const arbitraryDirection = fc.constantFrom("up" as const, "down" as const);

    fc.assert(
      fc.property(arbitraryIndex, arbitraryDirection, (index, direction) => {
        const shifted = shiftGearIndex(index, direction);
        expect(shifted).toBeGreaterThanOrEqual(MIN_GEAR_INDEX);
        expect(shifted).toBeLessThanOrEqual(MAX_GEAR_INDEX);
      }),
    );
  });
});
