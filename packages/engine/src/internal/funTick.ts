import { FUN_ITEMS, type Meters, type RideEvent, type Seconds } from "@voltonaut/shared";

import { nextRandom, pickItem } from "../fun/rng.js";
import { NO_EFFECT, type PhysicsEffect } from "../physics/effects.js";
import { crossedBoundaryM } from "./segments.js";
import type { FunModeState } from "./state.js";

/** Item positions and wrap rule of the route (spec E9-01 AK2). */
export interface ItemBoxes {
  readonly positionsM: readonly Meters[];
  readonly loop: boolean;
}

/** Activates the held item; ignored while another effect runs (AK4). */
export function activateItem(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fun slice is engine-owned mutable state; only packages/engine/src/internal mutates it.
  fun: FunModeState,
  tS: Seconds,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the activation event.
  events: RideEvent[],
): void {
  const item = fun.heldItem;

  if (item === undefined || fun.activeItem !== undefined) return;

  const durationS = FUN_ITEMS[item].durationS;

  fun.heldItem = undefined;
  fun.activeItem = item;
  fun.activeRemainingS = durationS;
  events.push({ type: "item.activated", item, durationS, tS });
}

/** Counts the active effect down; called for running (non-paused) ticks only (AK5). */
export function countDownEffect(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fun slice is engine-owned mutable state; only packages/engine/src/internal mutates it.
  fun: FunModeState,
  dtS: Seconds,
  tS: Seconds,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the expiry event.
  events: RideEvent[],
): void {
  const item = fun.activeItem;

  if (item === undefined) return;

  fun.activeRemainingS -= dtS;

  // Half a tick absorbs float drift from repeated subtraction.
  if (fun.activeRemainingS > dtS / 2) return;

  fun.activeItem = undefined;
  fun.activeRemainingS = 0;
  events.push({ type: "item.expired", item, tS });
}

/**
 * Fills an empty slot from the seed when the rider crosses an item box (AK2–AK4).
 * Returns the next rng state; unchanged when nothing was drawn.
 */
export function collectItemBox(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The fun slice is engine-owned mutable state; only packages/engine/src/internal mutates it.
  fun: FunModeState,
  boxes: ItemBoxes,
  move: { readonly fromM: Meters; readonly toM: Meters; readonly tS: Seconds },
  rngState: number,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the collection event.
  events: RideEvent[],
): number {
  if (fun.heldItem !== undefined) return rngState;

  const crossed = boxes.positionsM.some((boxM) =>
    crossedBoundaryM(move.fromM, move.toM, boxM, boxes.loop),
  );

  if (!crossed) return rngState;

  const draw = nextRandom(rngState);
  const item = pickItem(draw.value);

  fun.heldItem = item;
  events.push({ type: "item.collected", item, tS: move.tS });

  return draw.state;
}

/** Physics effect of the active item; NO_EFFECT without one. */
export function funEffect(fun: Readonly<FunModeState>): PhysicsEffect {
  return fun.activeItem === undefined ? NO_EFFECT : FUN_ITEMS[fun.activeItem];
}
