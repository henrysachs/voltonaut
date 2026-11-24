import { expect, it } from "vitest";

import type { FunItemId, RideEvent, RideMode, TickInputs } from "@voltonaut/shared";

import { GEAR_RATIOS, START_GEAR_INDEX } from "../gears/presets.js";
import { countDownEffect, type ItemBoxes } from "./funTick.js";
import { enterMode } from "./modeTick.js";
import { createRideState, type FunModeState, type RideState } from "./state.js";

const NO_BOXES: ItemBoxes = { positionsM: [], loop: true };

function stateIn(mode: RideMode): RideState {
  return createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps: 5,
    routePosM: 0,
    mode,
    seed: 42,
  });
}

function funSlice(held?: FunItemId, active?: FunItemId): FunModeState {
  return {
    kind: "fun",
    heldItem: held,
    activeItem: active,
    activeRemainingS: active === undefined ? 0 : 5,
  };
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
function press(state: RideState, mode: RideMode): readonly RideEvent[] {
  return enterMode(state, mode, NO_BOXES).applyIntents(intents(mode));
}

it("normal mode has no item slot and ignores the power-up button", () => {
  const state = stateIn("normal");

  expect(press(state, "normal")).toEqual([]);
  expect(state.mode).toEqual({ kind: "normal" });
});

it("a mode switch replaces the whole mode slice", () => {
  const state = stateIn("fun");

  state.mode = funSlice("tailwind", "aeroBoost");
  enterMode(state, "normal", NO_BOXES);
  expect(state.mode).toEqual({ kind: "normal" });
  enterMode(state, "fun", NO_BOXES);
  expect(state.mode).toEqual(funSlice());
});

it("ignores activation while another effect is still running", () => {
  const state = stateIn("fun");

  state.mode = funSlice("tailwind", "aeroBoost");
  expect(press(state, "fun")).toEqual([]);
  expect(state.mode).toMatchObject({ heldItem: "tailwind", activeItem: "aeroBoost" });
});

it("expires exactly when the remaining time reaches half a tick", () => {
  const fun = funSlice(undefined, "aeroBoost");
  const events: RideEvent[] = [];

  fun.activeRemainingS = 1.25;
  countDownEffect(fun, 0.5, 0, events);
  expect([fun.activeItem, events]).toEqual(["aeroBoost", []]);
  countDownEffect(fun, 0.5, 0, events);
  expect(fun.activeItem).toBeUndefined();
  expect(events.map((event) => event.type)).toEqual(["item.expired"]);
});
