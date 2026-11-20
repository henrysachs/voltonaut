import { describe, expect, it } from "vitest";

import { DEFAULT_RIDER_PARAMS } from "../physics/params.js";
import type { RiderParams } from "../physics/params.js";
import {
  aeroCoefficientKgPerM,
  DEFAULT_TRAINER_MASS_KG,
  effectiveGradePct,
  ROUTE_GRADE_FLOOR_PCT,
  TRAINER_GRADE_MAX_PCT,
  TRAINER_GRADE_MIN_PCT,
  simulationCommand,
} from "./gradeMap.js";

const PHYSICAL_RATIO = 42 / 14;

function gradeFor(
  cadenceRpm: number,
  gearRatio: number,
  routeGradePct: number,
  params: RiderParams = DEFAULT_RIDER_PARAMS,
): number {
  return effectiveGradePct({
    cadenceRpm,
    gearRatio,
    physicalRatio: PHYSICAL_RATIO,
    routeGradePct,
    riderParams: params,
    trainerMassKg: DEFAULT_TRAINER_MASS_KG,
  });
}

describe("effectiveGradePct (strategy A)", () => {
  it("reproduces the hand-computed flat grades for gears 12 and 24 at 90 rpm", () => {
    // gear 12 (ratio 2.30) on 0 %: vv = 7.262 m/s, Fv = 13.59 N,
    // Ft = 10.42 N, vt = 9.472 m/s, load = (Ft - cw*vt^2)/(mT*g) - crr -> -1.28 %.
    expect(gradeFor(90, 2.3, 0)).toBeCloseTo(-1.28, 1);

    // gear 24 (ratio 5.49): Ft = 113.6 N -> +11.48 %.
    expect(gradeFor(90, 5.49, 0)).toBeCloseTo(11.48, 1);
  });

  it("clamps descents to -5 % route grade before the trainer model", () => {
    const atSix = gradeFor(90, 2.3, -6);
    const atFive = gradeFor(90, 2.3, ROUTE_GRADE_FLOOR_PCT);

    expect(atSix).toBe(atFive);
  });

  it("raises the effective grade on steeper virtual climbs", () => {
    expect(gradeFor(90, 2.3, 8)).toBeGreaterThan(gradeFor(90, 2.3, 0));
    expect(gradeFor(90, 2.3, 4)).toBeLessThan(gradeFor(90, 2.3, 8));
  });

  it("keeps the gravity load with no cadence (the command layer then holds)", () => {
    // Without cadence the trainer model still sees the virtual gravity load:
    // Fv = 64.97 + 3.25 N at 8 %, Ft = Fv * 2.3 / 3, no trainer-speed aero.
    expect(gradeFor(0, 2.3, 8)).toBeCloseTo(6.03, 1);
    expect(Number.isFinite(gradeFor(0, 2.3, 8))).toBe(true);
  });

  it("keeps the result inside [-10, +20] even for absurd inputs", () => {
    expect(gradeFor(200, 5.49, 30)).toBe(TRAINER_GRADE_MAX_PCT);
    expect(gradeFor(200, 5.49, -30)).toBeGreaterThanOrEqual(TRAINER_GRADE_MIN_PCT);
    expect(gradeFor(200, 5.49, -30)).toBeLessThanOrEqual(TRAINER_GRADE_MAX_PCT);
  });

  it("builds the FTMS 0x11 simulation command from the rider params", () => {
    const command = simulationCommand(4.2, DEFAULT_RIDER_PARAMS);

    expect(command).toEqual({
      type: "simulation",
      gradePct: 4.2,
      windMps: 0,
      crr: 0.004,
      cwKgPerM: aeroCoefficientKgPerM(0.32),
    });
    expect(aeroCoefficientKgPerM(0.32)).toBeCloseTo(0.196, 10);
  });
});
