import type { Seconds } from "@voltonaut/shared";

/** Fixed engine tick (20 Hz); the driver supplies elapsed time, never a wall clock. */
export const TICK_S: Seconds = 0.05;

/** Catch-up cap per wake-up: 120 ticks = 6 s of virtual time. */
export const MAX_CATCHUP_TICKS = 120;

export interface CatchupPlan {
  /** Ticks to run now. */
  readonly ticksToRun: number;
  /** Virtual seconds beyond the cap that get discarded (ride.clockSkipped). */
  readonly skippedS: Seconds;
}

/**
 * Deterministic catch-up plan for one wake-up: floor(accumulated / TICK_S)
 * ticks, capped at MAX_CATCHUP_TICKS; the excess is skipped, after which the
 * data-loss rule lets the rider roll out instead of standing still.
 */
export function planCatchup(accumulatedS: Seconds): CatchupPlan {
  if (accumulatedS <= 0 || !Number.isFinite(accumulatedS)) {
    return { ticksToRun: 0, skippedS: 0 };
  }

  const ticks = Math.floor(accumulatedS / TICK_S);

  if (ticks <= MAX_CATCHUP_TICKS) {
    return { ticksToRun: ticks, skippedS: 0 };
  }

  return { ticksToRun: MAX_CATCHUP_TICKS, skippedS: (ticks - MAX_CATCHUP_TICKS) * TICK_S };
}
