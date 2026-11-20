import { array, assert, constantFrom, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_GEAR_INDEX, MIN_GEAR_INDEX, shiftGearIndex } from "./gears.js";

interface ShiftPair {
  readonly direction: "up" | "down";
  readonly opposite: "up" | "down";
  readonly startIndex: number;
}

describe("gear property P5", () => {
  it("keeps the gear inside [1, 24] for arbitrary shift chains", () => {
    assert(
      property(
        integer({ min: 0, max: 23 }),
        array(constantFrom("up", "down"), { maxLength: 100 }),
        (startIndex, shifts: readonly ("up" | "down")[]) => {
          let index = startIndex;

          for (const direction of shifts) {
            index = shiftGearIndex(index, direction);
          }

          expect(index).toBeGreaterThanOrEqual(MIN_GEAR_INDEX);
          expect(index).toBeLessThanOrEqual(MAX_GEAR_INDEX);
        },
      ),
    );
  });

  it("returns to the original gear after n ups followed by n downs (no clamp hit)", () => {
    assert(
      property(integer({ min: 0, max: 23 }), integer({ min: 0, max: 23 }), (startIndex, maxUps) => {
        const ups = Math.min(maxUps, MAX_GEAR_INDEX - startIndex);
        let index = startIndex;

        for (let step = 0; step < ups; step += 1) {
          index = shiftGearIndex(index, "up");
        }

        for (let step = 0; step < ups; step += 1) {
          index = shiftGearIndex(index, "down");
        }

        expect(index).toBe(startIndex);
      }),
    );
  });
});

describe("gear single-pair reversibility", () => {
  it.each([
    { direction: "up", opposite: "down", startIndex: MAX_GEAR_INDEX - 1 },
    { direction: "down", opposite: "up", startIndex: MIN_GEAR_INDEX + 1 },
  ] satisfies readonly {
    readonly direction: "up" | "down";
    readonly opposite: "up" | "down";
    readonly startIndex: number;
  }[])(
    "reverses $direction away from the boundaries",
    ({ direction, opposite, startIndex }: ShiftPair) => {
      const afterFirst = shiftGearIndex(startIndex, direction);
      const afterSecond = shiftGearIndex(afterFirst, opposite);

      expect(afterSecond).toBe(startIndex);
    },
  );
});
