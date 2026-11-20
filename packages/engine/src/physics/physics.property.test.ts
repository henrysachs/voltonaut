import { assert, float, integer, property, record } from "fast-check";
import { describe, expect, it } from "vitest";

import { advanceSpeedMps } from "./integrate.js";

const paramsArbitrary = record({
  massKg: integer({ min: 30, max: 120 }),
  bikeMassKg: integer({ min: 1, max: 20 }),
  cdaM2: float({ min: Math.fround(0.2), max: Math.fround(0.5), noNaN: true }),
  crr: float({ min: Math.fround(0.002), max: Math.fround(0.01), noNaN: true }),
  wheelCircM: float({ min: Math.fround(1.9), max: Math.fround(2.4), noNaN: true }),
});

describe("physics properties", () => {
  // P1: more power is never slower tick by tick, from identical starts.
  it("P1: higher power never yields lower speed or distance", () => {
    assert(
      property(
        paramsArbitrary,
        float({ min: -30, max: 30, noNaN: true }),
        integer({ min: 0, max: 2000 }),
        integer({ min: 0, max: 2000 }),
        float({ min: 0, max: 15, noNaN: true }),
        (params, gradePct, powerOneW, powerTwoW, initialSpeedMps) => {
          const lowPowerW = Math.min(powerOneW, powerTwoW);
          const highPowerW = Math.max(powerOneW, powerTwoW);
          let lowSpeed = initialSpeedMps;
          let highSpeed = initialSpeedMps;
          let lowDistanceM = 0;
          let highDistanceM = 0;

          for (let tick = 0; tick < 50; tick += 1) {
            lowSpeed = advanceSpeedMps(lowSpeed, gradePct, lowPowerW, params, 0, 0.05);
            highSpeed = advanceSpeedMps(highSpeed, gradePct, highPowerW, params, 0, 0.05);
            lowDistanceM += lowSpeed * 0.05;
            highDistanceM += highSpeed * 0.05;

            expect(highSpeed).toBeGreaterThanOrEqual(lowSpeed);
            expect(highDistanceM).toBeGreaterThanOrEqual(lowDistanceM);
          }
        },
      ),
    );
  });
});

describe("physics grade ordering", () => {
  // P2: a steeper grade is never faster at the same power.
  it("P2: steeper grade never yields higher speed", () => {
    assert(
      property(
        paramsArbitrary,
        float({ min: -30, max: 30, noNaN: true }),
        float({ min: -30, max: 30, noNaN: true }),
        integer({ min: 0, max: 2000 }),
        float({ min: 0, max: 15, noNaN: true }),
        (params, gradeOnePct, gradeTwoPct, powerW, initialSpeedMps) => {
          const flatGradePct = Math.min(gradeOnePct, gradeTwoPct);
          const steepGradePct = Math.max(gradeOnePct, gradeTwoPct);
          let flatSpeed = initialSpeedMps;
          let steepSpeed = initialSpeedMps;

          for (let tick = 0; tick < 50; tick += 1) {
            flatSpeed = advanceSpeedMps(flatSpeed, flatGradePct, powerW, params, 0, 0.05);
            steepSpeed = advanceSpeedMps(steepSpeed, steepGradePct, powerW, params, 0, 0.05);

            expect(flatSpeed).toBeGreaterThanOrEqual(steepSpeed);
          }
        },
      ),
    );
  });
});

describe("physics stability", () => {
  // P3: speed stays finite and >= 0 over extreme random sequences with dt jitter.
  it("P3: speed is never negative, NaN or infinite", () => {
    assert(
      property(
        paramsArbitrary,
        integer({ min: 0, max: 2000 }),
        float({ min: -30, max: 30, noNaN: true }),
        float({ min: Math.fround(0.045), max: Math.fround(0.055), noNaN: true }),
        float({ min: 0, max: 15, noNaN: true }),
        (params, powerW, gradePct, dtS, initialSpeedMps) => {
          let speed = initialSpeedMps;

          for (let tick = 0; tick < 200; tick += 1) {
            speed = advanceSpeedMps(speed, gradePct, powerW, params, 0, dtS);

            expect(Number.isFinite(speed)).toBe(true);
            expect(speed).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
