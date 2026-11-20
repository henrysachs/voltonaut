import type { Kg, Meters, Pct } from "@voltonaut/shared";

import type { RiderProfile } from "@voltonaut/shared";

/** Pinned physics constants (docs/03-engine-physics.md section 2, spec E3-01 AK1). */
export const G_MPS2 = 9.81;
export const RHO_KG_PER_M3 = 1.225;
export const ETA_DRIVE = 0.97;
export const ROTATING_MASS_KG = 1.0;
export const SPEED_FLOOR_MPS = 0.5;
export const DEFAULT_CRR = 0.004;
export const DEFAULT_CDA_M2 = 0.32;
export const DEFAULT_WHEEL_CIRC_M = 2.105;

/** Immutable per-ride physics parameters; frozen from the rider profile at ride start. */
export interface RiderParams {
  readonly massKg: Kg;
  readonly bikeMassKg: Kg;
  readonly cdaM2: number;
  readonly crr: number;
  readonly wheelCircM: Meters;
}

export const DEFAULT_RIDER_PARAMS: RiderParams = {
  massKg: 75,
  bikeMassKg: 8,
  cdaM2: DEFAULT_CDA_M2,
  crr: DEFAULT_CRR,
  wheelCircM: DEFAULT_WHEEL_CIRC_M,
};

/** DuBois body surface area in m^2. */
export function bodySurfaceAreaM2(heightCm: number, massKg: number): number {
  return 0.007184 * heightCm ** 0.725 * massKg ** 0.425;
}

/**
 * CdA estimate scaled by DuBois body surface area, anchored so that the default
 * profile (185 cm / 75 kg) reproduces exactly 0.32 m^2.
 */
export function estimateCdaM2(heightCm: number, massKg: number): number {
  return (DEFAULT_CDA_M2 * bodySurfaceAreaM2(heightCm, massKg)) / bodySurfaceAreaM2(185, 75);
}

/** Derives the frozen ride parameters from a validated rider profile. */
export function riderParamsFromProfile(profile: RiderProfile): RiderParams {
  return {
    massKg: profile.massKg,
    bikeMassKg: profile.bike.massKg,
    cdaM2: estimateCdaM2(profile.heightCm, profile.massKg),
    crr: DEFAULT_CRR,
    wheelCircM: profile.bike.wheelCircM,
  };
}

/** Rider + bike mass; the trainer command path uses the same total mass. */
export function totalMassKg(params: RiderParams): number {
  return params.massKg + params.bikeMassKg;
}

/** Effective inertial mass including the wheels (m + I/r^2 ~= m + 1 kg). */
export function effectiveMassKg(params: RiderParams): number {
  return totalMassKg(params) + ROTATING_MASS_KG;
}

/** Slope angle theta = atan(gradePct / 100) in radians. */
export function slopeAngleRad(gradePct: Pct): number {
  return Math.atan(gradePct / 100);
}
