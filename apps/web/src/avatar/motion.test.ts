import { describe, expect, it } from "vitest";

import { advanceCrankRad, followFraction, wheelAngleRad } from "./motion.js";

describe("bicycle motion", () => {
  it("derives wheel rotation from cumulative distance including multiple laps", () => {
    expect(wheelAngleRad(2.105, 2.105)).toBeCloseTo(Math.PI * 2);
    expect(wheelAngleRad(10002.105, 2.105) - wheelAngleRad(10000, 2.105)).toBeCloseTo(Math.PI * 2);
    expect(wheelAngleRad(0, 2.105)).toBe(0);
  });

  it("turns the crank 90 times at 90 rpm for one ride minute", () => {
    let angleRad = 0;

    for (let frame = 0; frame < 1200; frame += 1) {
      angleRad = advanceCrankRad(angleRad, 90, 0.05);
    }

    expect(angleRad / (2 * Math.PI)).toBeCloseTo(90, 8);
    expect(advanceCrankRad(angleRad, 0, 10)).toBe(angleRad);
    expect(advanceCrankRad(angleRad, -10, 10)).toBe(angleRad);
    expect(advanceCrankRad(angleRad, 90, -1)).toBe(angleRad);
  });

  it("follows smoothly without frame-rate dependent overshoot", () => {
    expect(followFraction(0)).toBe(0);
    expect(followFraction(-1)).toBe(0);
    expect(followFraction(1)).toBeGreaterThan(0.99);
    expect(followFraction(1 / 60)).toBeLessThan(1);
    expect((1 - followFraction(1 / 60)) ** 60).toBeCloseTo(1 - followFraction(1));
  });
});
