import { expect, it } from "vitest";

import type { FunItemId, RideEvent, RideMode, TickInputs } from "@voltonaut/shared";

import { GEAR_RATIOS, START_GEAR_INDEX } from "../gears/presets.js";
import { applyFunIntents, countDownEffect } from "./funTick.js";
import { createRideState, type RideState } from "./state.js";

function stateWith(mode: RideMode, held?: FunItemId, active?: FunItemId): RideState {
  const state = createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps: 5,
    routePosM: 0,
    mode,
    seed: 42,
  });

  state.heldItem = held;
  state.activeItem = active;
  state.activeRemainingS = active === undefined ? 0 : 5;

  return state;
}

function intents(mode: RideMode): TickInputs {
  return {
    powerW: 200,
    cadenceRpm: 90,
    hrBpm: undefined,
    shifts: 0,
    trainerDataFresh: true,
    useItem: true,
    mode,
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The test drives the engine-owned mutable RideState through its internal writer.
function activate(state: RideState, mode: RideMode): readonly RideEvent[] {
  const events: RideEvent[] = [];

  applyFunIntents(state, intents(mode), events);

  return events;
}

it("ignores the power-up button in normal mode even with a stray held item", () => {
  const state = stateWith("normal", "tailwind");

  expect(activate(state, "normal")).toEqual([]);
  expect(state.heldItem).toBe("tailwind");
});

it("ignores activation while another effect is still running", () => {
  const state = stateWith("fun", "tailwind", "aeroBoost");

  expect(activate(state, "fun")).toEqual([]);
  expect([state.heldItem, state.activeItem]).toEqual(["tailwind", "aeroBoost"]);
});

it("expires exactly when the remaining time reaches half a tick", () => {
  const state = stateWith("fun", undefined, "aeroBoost");
  const events: RideEvent[] = [];

  state.activeRemainingS = 1.25;
  countDownEffect(state, 0.5, events);
  expect([state.activeItem, events]).toEqual(["aeroBoost", []]);
  countDownEffect(state, 0.5, events);
  expect(state.activeItem).toBeUndefined();
  expect(events.map((event) => event.type)).toEqual(["item.expired"]);
});
