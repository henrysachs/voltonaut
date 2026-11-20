import type { Pct, Rpm } from "@voltonaut/shared";

import type { TrainerCommand } from "@voltonaut/shared";

import type { RiderParams } from "../physics/params.js";
import { G_MPS2, RHO_KG_PER_M3, slopeAngleRad, totalMassKg } from "../physics/params.js";

/**
 * Trainer-internal mass assumption (mT) for the FTMS simulation model.
 * Default 83 kg (75 rider + 8 bike); E2 calibrates this against real hardware.
 */
export const DEFAULT_TRAINER_MASS_KG = 83;

/** Trainer grade limits from docs/03 section 4 (strategy A sketch). */
export const TRAINER_GRADE_MIN_PCT = -10;
export const TRAINER_GRADE_MAX_PCT = 20;

/** Descents clamp to -5 %: the trainer cannot drive the rider forward. */
export const ROUTE_GRADE_FLOOR_PCT = -5;

/** Aero coefficient we send along with every simulation command (FTMS 0x11). */
export function aeroCoefficientKgPerM(cdaM2: number): number {
  return 0.5 * RHO_KG_PER_M3 * cdaM2;
}

export interface GradeMapInputs {
  readonly cadenceRpm: Rpm;
  /** Virtual gear ratio (preset table), not the physical drivetrain ratio. */
  readonly gearRatio: number;
  /** Real drivetrain ratio at the trainer (chainring / cog). */
  readonly physicalRatio: number;
  /** Smoothed route grade in percent, unclamped. */
  readonly routeGradePct: Pct;
  readonly riderParams: RiderParams;
  /** Trainer-internal mass assumption (mT), calibratable. */
  readonly trainerMassKg: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Strategy A "Effective Grade" (FTMS 0x11): maps route grade + virtual gear onto
 * the grade the trainer must simulate so pedal torque matches the virtual road
 * (docs/03 section 4). Result is clamped to [-10, +20] % instead of overflowing.
 */
export function effectiveGradePct(inputs: GradeMapInputs): Pct {
  const cadenceRps = inputs.cadenceRpm / 60;
  const virtualSpeedMps = cadenceRps * inputs.gearRatio * inputs.riderParams.wheelCircM;
  const clampedGradePct = Math.max(inputs.routeGradePct, ROUTE_GRADE_FLOOR_PCT);
  const theta = slopeAngleRad(clampedGradePct);
  const massKg = totalMassKg(inputs.riderParams);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const virtualForceN =
    massKg * G_MPS2 * sinTheta +
    massKg * G_MPS2 * cosTheta * inputs.riderParams.crr +
    0.5 * RHO_KG_PER_M3 * inputs.riderParams.cdaM2 * virtualSpeedMps ** 2;

  const trainerForceN = (virtualForceN * inputs.gearRatio) / inputs.physicalRatio;
  const trainerSpeedMps = cadenceRps * inputs.physicalRatio * inputs.riderParams.wheelCircM;
  const cwKgPerM = aeroCoefficientKgPerM(inputs.riderParams.cdaM2);

  const loadRatio =
    (trainerForceN - cwKgPerM * trainerSpeedMps ** 2) / (inputs.trainerMassKg * G_MPS2);

  const sinPrime = clamp(loadRatio - inputs.riderParams.crr, -1, 1);

  return clamp(100 * Math.tan(Math.asin(sinPrime)), TRAINER_GRADE_MIN_PCT, TRAINER_GRADE_MAX_PCT);
}

/** The FTMS 0x11 simulation command for an effective grade. */
export function simulationCommand(gradeEffPct: Pct, riderParams: RiderParams): TrainerCommand {
  return {
    type: "simulation",
    gradePct: gradeEffPct,
    windMps: 0,
    crr: riderParams.crr,
    cwKgPerM: aeroCoefficientKgPerM(riderParams.cdaM2),
  };
}
