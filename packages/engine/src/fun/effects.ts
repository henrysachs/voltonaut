import { FUN_ITEMS, type FunItemId, type Mps, type Pct } from "@voltonaut/shared";

import type { RiderParams } from "../physics/params.js";

/**
 * Rider params for the speed integration while an item is active. Physics only:
 * the trainer command keeps the profile params (ADR-027). Featherweight acts on
 * flat and uphill road only.
 */
export function effectiveRiderParams(
  base: RiderParams,
  active: FunItemId | undefined,
  gradePct: Pct,
): RiderParams {
  if (active === undefined) return base;

  const effect = FUN_ITEMS[active];
  const massFactor = gradePct >= 0 ? effect.massFactor : 1;

  if (effect.cdaFactor === 1 && massFactor === 1) return base;

  return {
    ...base,
    cdaM2: base.cdaM2 * effect.cdaFactor,
    massKg: base.massKg * massFactor,
    bikeMassKg: base.bikeMassKg * massFactor,
  };
}

/** Physics-only wind of the active item; 0 without one. */
export function effectWindMps(active?: FunItemId): Mps {
  return active === undefined ? 0 : FUN_ITEMS[active].windMps;
}
