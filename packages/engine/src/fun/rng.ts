import { FUN_ITEM_IDS, type FunItemId } from "@voltonaut/shared";

export interface RandomStep {
  readonly value: number;
  readonly state: number;
}

/** mulberry32: deterministic 32-bit PRNG; value in [0, 1). */
export function nextRandom(state: number): RandomStep {
  const nextState = (state + 0x6d_2b_79_f5) >>> 0;

  let mixed = Math.imul(nextState ^ (nextState >>> 15), nextState | 1);

  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

  return { value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296, state: nextState };
}

/** Uniform pick over FUN_ITEM_IDS for a value in [0, 1); values outside clamp to the ends. */
export function pickItem(value: number): FunItemId {
  const index = Math.max(
    0,
    Math.min(FUN_ITEM_IDS.length - 1, Math.floor(value * FUN_ITEM_IDS.length)),
  );

  return FUN_ITEM_IDS[index] ?? "aeroBoost";
}
