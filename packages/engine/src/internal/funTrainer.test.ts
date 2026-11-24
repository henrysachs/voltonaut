import { expect, it } from "vitest";

import { FUN_ITEM_IDS, type FunItemId, type TickInputs } from "@voltonaut/shared";

import { KOM_CLIMB } from "../elevation/data/kom-climb.js";
import { createRoute } from "../elevation/route.js";
import { GEAR_RATIOS, START_GEAR_INDEX } from "../gears/presets.js";
import { DEFAULT_RIDER_PARAMS } from "../physics/params.js";
import { createRideState, type RideState } from "./state.js";
import { tick, type EngineContext } from "./tick.js";

const context: EngineContext = {
  route: createRoute(KOM_CLIMB),
  riderParams: DEFAULT_RIDER_PARAMS,
  gearRatios: GEAR_RATIOS,
  physicalRatio: 3,
  trainerMassKg: 83,
  itemBoxesM: [],
};

const inputs: TickInputs = {
  powerW: 250,
  cadenceRpm: 90,
  hrBpm: undefined,
  shifts: 0,
  trainerDataFresh: true,
  useItem: false,
  mode: "fun",
};

function funState(activeItem?: FunItemId): RideState {
  const state = createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps: 6,
    routePosM: 400,
    mode: "fun",
    seed: 42,
  });

  state.mode = {
    kind: "fun",
    heldItem: undefined,
    activeItem,
    activeRemainingS: activeItem === undefined ? 0 : 10,
  };

  return state;
}

it.each(FUN_ITEM_IDS)("%s changes speed but leaves the trainer command unchanged", (item) => {
  const withItem = tick(funState(item), inputs, context, 0.05);
  const without = tick(funState(), inputs, context, 0.05);

  expect(without.trainerCommand).toBeDefined();
  expect(withItem.trainerCommand).toEqual(without.trainerCommand);
  expect(withItem.state.speedMps).toBeGreaterThan(without.state.speedMps);
});

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The probe ticks the engine-owned mutable RideState.
function commandsOver(state: RideState, mode: TickInputs["mode"]) {
  return Array.from(
    { length: 40 },
    () => tick(state, { ...inputs, mode }, context, 0.05).trainerCommand,
  );
}

function normalState(): RideState {
  return createRideState({
    gearIndex: START_GEAR_INDEX,
    gearRatio: GEAR_RATIOS[START_GEAR_INDEX] ?? 2.3,
    speedMps: 6,
    routePosM: 400,
    mode: "normal",
    seed: 42,
  });
}

it("normal and fun mode without an active item send identical trainer commands", () => {
  expect(commandsOver(normalState(), "normal")).toEqual(commandsOver(funState(), "fun"));
});
