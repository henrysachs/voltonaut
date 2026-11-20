import { assert, float, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_RIDER_PARAMS } from "../physics/params.js";
import { effectiveGradePct, TRAINER_GRADE_MAX_PCT, TRAINER_GRADE_MIN_PCT } from "./gradeMap.js";

const RATIOS = [
  0.75, 0.83, 0.92, 1.02, 1.13, 1.25, 1.38, 1.53, 1.69, 1.88, 2.08, 2.3, 2.55, 2.82, 3.01, 3.22,
  3.44, 3.68, 3.93, 4.21, 4.5, 4.81, 5.14, 5.49,
];

function gradeFor(
  cadenceRpm: number,
  gearRatio: number | undefined,
  routeGradePct: number,
  physicalRatio = 3,
): number {
  if (gearRatio === undefined) {
    throw new RangeError("test gear is outside the preset");
  }

  return effectiveGradePct({
    cadenceRpm,
    gearRatio,
    physicalRatio,
    routeGradePct,
    riderParams: DEFAULT_RIDER_PARAMS,
    trainerMassKg: 83,
  });
}

describe("trainer properties", () => {
  // P4: a higher gear never lowers the effective grade (strategy A) at the
  // same cadence, route grade and physical ratio. The claim holds wherever
  // the virtual wheel force is non-negative (flat and climbs); on steep
  // descents the linear Ft = Fv * ratio model inverts, which the descent
  // test below pins as documented behavior for E2 calibration.
  it("P4: higher gear => gradeEff never lower on flats and climbs", () => {
    assert(
      property(
        integer({ min: 0, max: 200 }),
        float({ min: 0, max: 30, noNaN: true }),
        float({ min: 1, max: 6, noNaN: true }),
        integer({ min: 0, max: 23 }),
        integer({ min: 0, max: 23 }),
        (cadenceRpm, routeGradePct, physicalRatio, lowIndex, highIndex) => {
          const lowRatio = RATIOS.at(Math.min(lowIndex, highIndex));
          const highRatio = RATIOS.at(Math.max(lowIndex, highIndex));

          const lowGrade = gradeFor(cadenceRpm, lowRatio, routeGradePct, physicalRatio);
          const highGrade = gradeFor(cadenceRpm, highRatio, routeGradePct, physicalRatio);

          // Monotone up to float noise in the tan/asin composition.
          expect(highGrade).toBeGreaterThanOrEqual(lowGrade - 1e-9);
        },
      ),
    );
  });

  it("documents the descent inversion of the linear model (E2 calibrates)", () => {
    // With no cadence the virtual force on a -6 % descent is negative, so a
    // higher gear deepens the simulated assistance instead of raising it.
    expect(gradeFor(0, 5.49, -6)).toBeLessThan(gradeFor(0, 0.75, -6));
  });
});

describe("trainer clamps and adjacent gears", () => {
  // P6: the effective grade always stays inside [-10, +20] (clamping, not overflow).
  it("P6: gradeEff stays within [-10, +20] for extreme inputs", () => {
    assert(
      property(
        integer({ min: 0, max: 200 }),
        float({ min: 0.5, max: 6, noNaN: true }),
        float({ min: 1, max: 6, noNaN: true }),
        float({ min: -30, max: 30, noNaN: true }),
        (cadenceRpm, gearRatio, physicalRatio, routeGradePct) => {
          const gradeEffPct = gradeFor(cadenceRpm, gearRatio, routeGradePct, physicalRatio);

          expect(gradeEffPct).toBeGreaterThanOrEqual(TRAINER_GRADE_MIN_PCT);
          expect(gradeEffPct).toBeLessThanOrEqual(TRAINER_GRADE_MAX_PCT);
        },
      ),
    );
  });

  it("holds the monotonic gear order across adjacent preset gears on climbs", () => {
    assert(
      property(
        integer({ min: 0, max: 200 }),
        float({ min: 0, max: 30, noNaN: true }),
        integer({ min: 1, max: 22 }),
        (cadenceRpm, routeGradePct, index) => {
          const lowRatio = RATIOS.at(index - 1);
          const highRatio = RATIOS.at(index);
          const lowGrade = gradeFor(cadenceRpm, lowRatio, routeGradePct);
          const highGrade = gradeFor(cadenceRpm, highRatio, routeGradePct);

          // Monotone up to float noise in the tan/asin composition.
          expect(highGrade).toBeGreaterThanOrEqual(lowGrade - 1e-9);
        },
      ),
    );
  });
});
