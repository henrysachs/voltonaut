import type { Meters, Seconds } from "@voltonaut/shared";

/** Odometer position along the route; loops wrap, non-loops clamp at the end. */
export function routePositionM(distanceM: Meters, lengthM: Meters, loop: boolean): Meters {
  if (loop) {
    return ((distanceM % lengthM) + lengthM) % lengthM;
  }

  return Math.min(lengthM, Math.max(0, distanceM));
}

/** Elevation gain only counts positive per-tick deltas (docs/03 section 1). */
export function elevationGainDeltaM(previousElevationM: Meters, nextElevationM: Meters): Meters {
  return Math.max(0, nextElevationM - previousElevationM);
}

/** Energy from raw measured power, not eta-adjusted (work at the pedals). */
export function energyDeltaKj(rawPowerW: number, dtS: Seconds): number {
  return (rawPowerW * dtS) / 1000;
}

/** Laps completed for a given odometer distance (loops only, non-loops never wrap). */
export function lapsCompleted(distanceM: Meters, lengthM: Meters, loop: boolean): number {
  if (!loop) {
    return 0;
  }

  return Math.floor(distanceM / lengthM);
}
