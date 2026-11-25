import type { Mps, Pct, Seconds, Watts } from "@voltonaut/shared";

import { advanceSpeedMps } from "./integrate.js";
import type { RiderParams } from "./params.js";

/**
 * A temporary change to the speed integration, independent of its source (fun
 * items now, normal power-ups #84 later). Physics only: the trainer command keeps
 * the profile params (ADR-028).
 */
export interface PhysicsEffect {
  /** Multiplier on the rider's CdA; 1 = unchanged. */
  readonly cdaFactor: number;
  /** Multiplier on rider and bike mass on flat and uphill road; 1 = unchanged. */
  readonly massFactor: number;
  /** Physics-only wind; negative = tailwind. */
  readonly windMps: Mps;
}

/** The effect of a tick without any active effect; leaves physics bit-identical. */
export const NO_EFFECT: PhysicsEffect = Object.freeze({ cdaFactor: 1, massFactor: 1, windMps: 0 });

/** Rider params under an effect; the mass factor acts at grade ≥ 0 only. */
export function effectiveRiderParams(
  base: RiderParams,
  effect: PhysicsEffect,
  gradePct: Pct,
): RiderParams {
  const massFactor = gradePct >= 0 ? effect.massFactor : 1;

  if (effect.cdaFactor === 1 && massFactor === 1) return base;

  return {
    ...base,
    cdaM2: base.cdaM2 * effect.cdaFactor,
    massKg: base.massKg * massFactor,
    bikeMassKg: base.bikeMassKg * massFactor,
  };
}

/** One Euler speed step with the effect applied to params and wind. */
export function advanceSpeedWithEffectMps(
  speedMps: Mps,
  gradePct: Pct,
  powerW: Watts,
  base: RiderParams,
  effect: PhysicsEffect,
  dtS: Seconds,
): Mps {
  return advanceSpeedMps(
    speedMps,
    gradePct,
    powerW,
    effectiveRiderParams(base, effect, gradePct),
    effect.windMps,
    dtS,
  );
}
