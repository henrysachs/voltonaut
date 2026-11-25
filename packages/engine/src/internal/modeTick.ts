import type { Meters, RideEvent, RideMode, Seconds, TickInputs } from "@voltonaut/shared";

import { NO_EFFECT, type PhysicsEffect } from "../physics/effects.js";
import {
  activateItem,
  collectItemBox,
  countDownEffect,
  funEffect,
  type ItemBoxes,
} from "./funTick.js";
import { initialModeState, type RideState } from "./state.js";

/** What a ride mode contributes to one tick (ADR-028); bound to the tick's state. */
export interface ModeTick {
  /** Button intents at tick start, also while paused. */
  readonly applyIntents: (inputs: TickInputs) => readonly RideEvent[];
  /** Physics effect for this tick's speed step; never reaches the trainer command. */
  readonly effect: () => PhysicsEffect;
  /** Steps after the position update of a running tick. */
  readonly afterAdvance: (previousRoutePosM: Meters, dtS: Seconds) => readonly RideEvent[];
}

const NORMAL_TICK: ModeTick = Object.freeze({
  applyIntents: () => [],
  effect: () => NO_EFFECT,
  afterAdvance: () => [],
});

/**
 * Switches to the requested mode (a switch replaces the whole mode slice, spec
 * E9-01 AK7) and returns its tick contribution. The single place that branches
 * on the ride mode.
 */
export function enterMode(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it.
  state: RideState,
  requested: RideMode,
  boxes: ItemBoxes,
): ModeTick {
  if (requested !== state.mode.kind) state.mode = initialModeState(requested);

  const mode = state.mode;

  switch (mode.kind) {
    case "normal":
      return NORMAL_TICK;
    case "fun":
      return {
        applyIntents: (inputs) => {
          const events: RideEvent[] = [];

          if (inputs.useItem) activateItem(mode, state.tS, events);

          return events;
        },
        effect: () => funEffect(mode),
        afterAdvance: (previousRoutePosM, dtS) => {
          const events: RideEvent[] = [];

          countDownEffect(mode, dtS, state.tS, events);
          state.rngState = collectItemBox(
            mode,
            boxes,
            { fromM: previousRoutePosM, toM: state.routePosM, tS: state.tS },
            state.rngState,
            events,
          );

          return events;
        },
      };
    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
}
