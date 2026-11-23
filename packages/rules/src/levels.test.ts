import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";

import { LevelSchema, TotalXpSchema } from "@voltonaut/shared";

import { levelForXp, xpForLevel } from "./index.js";

describe("XP levels", () => {
  it("rejects missing scalar inputs at public boundaries", () => {
    expect(levelForXp).toThrow("Required");
    expect(xpForLevel).toThrow("Required");
  });

  it("starts level one at zero, caps at fifty, accepts all safe total XP", () => {
    expect(xpForLevel(LevelSchema.parse(1))).toBe(0);
    expect(levelForXp(TotalXpSchema.parse(0))).toBe(1);
    expect(xpForLevel(LevelSchema.parse(2))).toBe(1516);
    expect(xpForLevel(LevelSchema.parse(10))).toBe(19905);
    expect(xpForLevel(LevelSchema.parse(50))).toBe(261410);
    expect(levelForXp(TotalXpSchema.parse(Number.MAX_SAFE_INTEGER))).toBe(50);
  });

  it.each(Array.from({ length: 49 }, (_, index) => index + 2))(
    "uses the documented cumulative curve and exact boundary for level %s",
    (level) => {
      const threshold = Math.round(500 * level ** 1.6);
      expect(xpForLevel(LevelSchema.parse(level))).toBe(threshold);
      expect(levelForXp(TotalXpSchema.parse(threshold - 1))).toBe(level - 1);
      expect(levelForXp(TotalXpSchema.parse(threshold))).toBe(level);
      expect(levelForXp(TotalXpSchema.parse(threshold + 1))).toBe(level);
    },
  );

  it("never decreases level as total XP increases", () => {
    assert(
      property(integer({ min: 0, max: Number.MAX_SAFE_INTEGER - 1 }), (xp) => {
        expect(levelForXp(TotalXpSchema.parse(xp + 1))).toBeGreaterThanOrEqual(
          levelForXp(TotalXpSchema.parse(xp)),
        );
      }),
    );
  });
});
