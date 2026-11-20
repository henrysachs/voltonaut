import type { Mps, Pct, Seconds, Watts } from "@voltonaut/shared";

import type { RiderParams } from "./params.js";
import { DEFAULT_RIDER_PARAMS, effectiveMassKg } from "./params.js";
import { netForceN } from "./forces.js";

/** One explicit forward-Euler step: v' = clamp(v + dt * netForce / m_eff, 0, inf). */
export function advanceSpeedMps(
  speedMps: Mps,
  gradePct: Pct,
  powerW: Watts,
  params: RiderParams,
  windMps: Mps,
  dtS: Seconds,
): Mps {
  const next =
    speedMps +
    (dtS * netForceN(speedMps, gradePct, powerW, params, windMps)) / effectiveMassKg(params);

  return Math.max(0, next);
}

/** Speed after letting the system settle to a stationary state. */
export function stationarySpeedMps(
  gradePct: Pct,
  powerW: Watts,
  params: RiderParams = DEFAULT_RIDER_PARAMS,
  dtS: Seconds = 0.05,
): Mps {
  let speed = advanceSpeedMps(0, gradePct, powerW, params, 0, dtS);

  for (let tickIndex = 0; tickIndex < 80_000; tickIndex += 1) {
    const next = advanceSpeedMps(speed, gradePct, powerW, params, 0, dtS);

    if (Math.abs(next - speed) < 1e-12) {
      return next;
    }

    speed = next;
  }

  return speed;
}
