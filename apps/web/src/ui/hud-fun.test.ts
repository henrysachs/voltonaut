import { expect, it } from "vitest";

import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import { hudText, rideHudModelFrom, type RideHudModel } from "./hud.js";

const base: RideHudModel = {
  powerW: 200,
  cadenceRpm: 90,
  heartRateBpm: undefined,
  gearIndex: 11,
  speedKmh: 30,
  distanceKm: 1,
  elevationGainM: 0,
  energyKj: 10,
  paused: false,
  dataAgeS: 0,
  connected: true,
  fun: undefined,
};

function itemText(fun: RideHudModel["fun"]): string {
  return hudText({ ...base, fun }).item;
}

it("hides the item slot in normal mode", () => {
  expect(hudText(base).item).toBe("");
});

it("invites to collect a box in fun mode with an empty slot", () => {
  expect(itemText({ heldItem: undefined, activeItem: undefined, activeRemainingS: 0 })).toBe(
    "Spaß-Modus · nächste Item-Box sammeln",
  );
});

it("shows the held item name and how to trigger it", () => {
  expect(itemText({ heldItem: "aeroBoost", activeItem: undefined, activeRemainingS: 0 })).toBe(
    "Aero-Boost bereit · P oder Power-up-Taste",
  );
  expect(itemText({ heldItem: "featherweight", activeItem: undefined, activeRemainingS: 0 })).toBe(
    "Leichtgewicht bereit · P oder Power-up-Taste",
  );
});

it("shows remaining whole seconds while an effect is active", () => {
  expect(itemText({ heldItem: undefined, activeItem: "tailwind", activeRemainingS: 9.01 })).toBe(
    "Rückenwind aktiv · 10 s",
  );
  expect(itemText({ heldItem: undefined, activeItem: "tailwind", activeRemainingS: 0.05 })).toBe(
    "Rückenwind aktiv · 1 s",
  );
});

it("copies the fun view from the engine snapshot", () => {
  const engine = createEngine({
    route: createRoute(TEST_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
    mode: "fun",
  });

  expect(rideHudModelFrom(engine.snapshot(), true).fun).toEqual({
    heldItem: undefined,
    activeItem: undefined,
    activeRemainingS: 0,
  });
});
