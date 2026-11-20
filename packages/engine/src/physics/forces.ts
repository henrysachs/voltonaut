import type { Pct, Watts } from "@voltonaut/shared";

import type { RiderParams } from "./params.js";
import {
  G_MPS2,
  RHO_KG_PER_M3,
  ETA_DRIVE,
  slopeAngleRad,
  SPEED_FLOOR_MPS,
  totalMassKg,
} from "./params.js";

/** Individual resistive and propulsive forces in newtons. */
export interface PhysicsForces {
  /** Propulsive force eta * P / max(v, vFloor). */
  readonly propulsiveN: number;
  /** Gravity force m * g * sin(theta); positive when braking uphill. */
  readonly gravityN: number;
  /** Rolling resistance m * g * cos(theta) * Crr. */
  readonly rollingN: number;
  /** Aero drag 0.5 * rho * CdA * (v + wind)^2 * sign(v + wind). */
  readonly aeroN: number;
}

/** All four forces acting on the rider at one instant (docs/03 section 2). */
export function forces(
  speedMps: number,
  gradePct: Pct,
  powerW: Watts,
  params: RiderParams,
  windMps: number,
): PhysicsForces {
  const theta = slopeAngleRad(gradePct);
  const mass = totalMassKg(params);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  return {
    propulsiveN: (ETA_DRIVE * powerW) / Math.max(speedMps, SPEED_FLOOR_MPS),
    gravityN: mass * G_MPS2 * sinTheta,
    rollingN: mass * G_MPS2 * cosTheta * params.crr,
    aeroN:
      0.5 *
      RHO_KG_PER_M3 *
      params.cdaM2 *
      (speedMps + windMps) ** 2 *
      Math.sign(speedMps + windMps),
  };
}

/** Net force along the direction of travel: m_eff * dv/dt = this. */
export function netForceN(
  speedMps: number,
  gradePct: Pct,
  powerW: Watts,
  params: RiderParams,
  windMps: number,
): number {
  const f = forces(speedMps, gradePct, powerW, params, windMps);

  return f.propulsiveN - f.gravityN - f.rollingN - f.aeroN;
}
