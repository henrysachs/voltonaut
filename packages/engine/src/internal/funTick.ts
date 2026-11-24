import {
  FUN_ITEMS,
  type Meters,
  type RideEvent,
  type Seconds,
  type TickInputs,
} from "@voltonaut/shared";

import { effectiveRiderParams, effectWindMps } from "../fun/effects.js";
import { nextRandom, pickItem } from "../fun/rng.js";
import { advanceSpeedMps } from "../physics/integrate.js";
import type { RiderParams } from "../physics/params.js";
import { crossedBoundaryM } from "./segments.js";
import type { RideState } from "./state.js";

/**
 * Mode switch and item activation, applied at tick start (also while paused).
 * Switching to "normal" drops held and active items at once (spec E9-01 AK7).
 */
export function applyFunIntents(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it.
  state: RideState,
  inputs: TickInputs,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the activation event.
  events: RideEvent[],
): void {
  if (inputs.mode !== state.mode) {
    state.mode = inputs.mode;
    state.heldItem = undefined;
    state.activeItem = undefined;
    state.activeRemainingS = 0;
  }

  if (
    state.mode !== "fun" ||
    !inputs.useItem ||
    state.heldItem === undefined ||
    state.activeItem !== undefined
  )
    return;

  const item = state.heldItem;
  const durationS = FUN_ITEMS[item].durationS;

  state.heldItem = undefined;
  state.activeItem = item;
  state.activeRemainingS = durationS;
  events.push({ type: "item.activated", item, durationS, tS: state.tS });
}

/** Counts the active effect down; called for running (non-paused) ticks only (AK5). */
export function countDownEffect(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it.
  state: RideState,
  dtS: Seconds,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the expiry event.
  events: RideEvent[],
): void {
  const item = state.activeItem;

  if (item === undefined) return;

  state.activeRemainingS -= dtS;

  // Half a tick absorbs float drift from repeated subtraction.
  if (state.activeRemainingS > dtS / 2) return;

  state.activeItem = undefined;
  state.activeRemainingS = 0;
  events.push({ type: "item.expired", item, tS: state.tS });
}

/** Fills an empty slot from the seed when the rider crosses an item box (AK2–AK4). */
export function collectItemBoxes(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it.
  state: RideState,
  boxes: { readonly positionsM: readonly Meters[]; readonly loop: boolean },
  previousRoutePosM: Meters,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the collection event.
  events: RideEvent[],
): void {
  if (state.mode !== "fun" || state.heldItem !== undefined) return;

  const crossed = boxes.positionsM.some((boxM) =>
    crossedBoundaryM(previousRoutePosM, state.routePosM, boxM, boxes.loop),
  );

  if (!crossed) return;

  const draw = nextRandom(state.rngState);
  const item = pickItem(draw.value);

  state.rngState = draw.state;
  state.heldItem = item;
  events.push({ type: "item.collected", item, tS: state.tS });
}

/**
 * One Euler speed step with the active item applied. Items change physics only;
 * the trainer command keeps the profile params (ADR-028).
 */
export function nextSpeedMps(
  state: Readonly<Pick<RideState, "activeItem" | "gradePct" | "speedMps">>,
  base: RiderParams,
  rawPowerW: number,
  dtS: Seconds,
): number {
  return advanceSpeedMps(
    state.speedMps,
    state.gradePct,
    rawPowerW,
    effectiveRiderParams(base, state.activeItem, state.gradePct),
    effectWindMps(state.activeItem),
    dtS,
  );
}

/** Steps after the position update of a running tick: effect countdown, then box pickup. */
export function afterAdvance(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it.
  state: RideState,
  boxes: { readonly positionsM: readonly Meters[]; readonly loop: boolean },
  previousRoutePosM: Meters,
  dtS: Seconds,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives expiry and pickup events.
  events: RideEvent[],
): void {
  countDownEffect(state, dtS, events);
  collectItemBoxes(state, boxes, previousRoutePosM, events);
}
