import type { Mps, Seconds } from "./units.js";

/** "normal" is the default ride; "fun" enables item boxes (spec E9-01). */
export type RideMode = "normal" | "fun";

export type FunItemId = "aeroBoost" | "featherweight" | "tailwind";

export interface FunItemEffect {
  readonly durationS: Seconds;
  /** Multiplier on the rider's CdA; 1 = unchanged. */
  readonly cdaFactor: number;
  /** Multiplier on rider and bike mass; 1 = unchanged. */
  readonly massFactor: number;
  /** Physics-only wind; negative = tailwind. Never sent to the trainer (ADR-027). */
  readonly windMps: Mps;
}

/** Phase 1 items, ⚠️ starting values. Order defines the seeded pick order. */
export const FUN_ITEMS: Readonly<Record<FunItemId, FunItemEffect>> = Object.freeze({
  aeroBoost: Object.freeze({ durationS: 15, cdaFactor: 0.85, massFactor: 1, windMps: 0 }),
  featherweight: Object.freeze({ durationS: 20, cdaFactor: 1, massFactor: 0.9, windMps: 0 }),
  tailwind: Object.freeze({ durationS: 10, cdaFactor: 1, massFactor: 1, windMps: -3 }),
});

export const FUN_ITEM_IDS: readonly FunItemId[] = Object.freeze([
  "aeroBoost",
  "featherweight",
  "tailwind",
]);
