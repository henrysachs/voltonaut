import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";

import { GEAR_COUNT } from "@voltonaut/engine";

import { gearLabel } from "./display.js";

describe("gearLabel", () => {
  it("shows the first gear as 1 and the last gear as 24", () => {
    expect(gearLabel(0)).toBe("1");
    expect(gearLabel(GEAR_COUNT - 1)).toBe("24");
  });

  it("rejects illegal gear indexes", () => {
    expect(() => gearLabel(-1)).toThrow(RangeError);
    expect(() => gearLabel(GEAR_COUNT)).toThrow(RangeError);
    expect(() => gearLabel(1.5)).toThrow(RangeError);
  });

  it("labels every legal gear index as one-based", () => {
    assert(
      property(integer({ min: 0, max: GEAR_COUNT - 1 }), (gearIndex) => {
        expect(Number(gearLabel(gearIndex))).toBe(gearIndex + 1);
      }),
    );
  });
});
