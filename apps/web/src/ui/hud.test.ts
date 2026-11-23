import { describe, expect, it } from "vitest";

import { createEngine, createRoute, FLAT_LOOP, type RideSnapshot } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import type { RideHudModel } from "./hud.js";
import type { HudTargets, TextTarget } from "./hud.js";
import { hudText, renderHud, rideHudModelFrom } from "./hud.js";

function target(): TextTarget & { read: () => string } {
  let text = "";

  return {
    write: (value: string): void => {
      text = value;
    },
    read: () => text,
  };
}

function snapshot(): RideSnapshot {
  const engine = createEngine({
    route: createRoute(FLAT_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
  });

  return engine.snapshot();
}

function model(overrides: Partial<RideHudModel> = {}): RideHudModel {
  return {
    powerW: 180.4,
    cadenceRpm: 92.2,
    heartRateBpm: 131.6,
    gearIndex: 3,
    speedKmh: 30.44,
    distanceKm: 12.345,
    elevationGainM: 210.4,
    energyKj: 640.6,
    paused: false,
    dataAgeS: 0,
    connected: true,
    ...overrides,
  };
}

describe("rideHudModelFrom", () => {
  it("maps a fresh snapshot into the HUD model", () => {
    const mapped = rideHudModelFrom(snapshot(), true);

    expect(mapped.gearIndex).toBe(11);
    expect(mapped.speedKmh).toBe(0);
    expect(mapped.distanceKm).toBe(0);
    expect(mapped.paused).toBe(false);
    expect(mapped.connected).toBe(true);
  });
});

describe("hudText", () => {
  it("formats all values and shows the one-based gear", () => {
    expect(hudText(model())).toEqual({
      powerW: "180 W",
      cadenceRpm: "92 rpm",
      heartRateBpm: "132 bpm",
      gear: "4",
      status: "Sim connected",
      speed: "30.4 km/h",
      distance: "12.35 km",
      elevationGain: "210 m",
      energy: "641 kJ",
      warning: "",
    });
  });

  it("shows a waiting status when no device is connected", () => {
    expect(hudText(model({ connected: false })).status).toBe("Waiting for devices");
  });

  it("shows the paused status and the data-loss warning", () => {
    expect(hudText(model({ paused: true })).status).toBe("Paused (auto)");
    expect(hudText(model({ dataAgeS: 3.05 })).warning).toBe("No trainer data");
    expect(hudText(model({ dataAgeS: 1 })).warning).toBe("");
  });
});

describe("renderHud", () => {
  it("writes every formatted value into its target", () => {
    const targets = {
      powerW: target(),
      cadenceRpm: target(),
      heartRateBpm: target(),
      gear: target(),
      status: target(),
      speed: target(),
      distance: target(),
      elevationGain: target(),
      energy: target(),
      warning: target(),
      sprint: target(),
      kom: target(),
    } satisfies HudTargets;

    renderHud(model({ gearIndex: 0, connected: false }), targets);

    expect(targets.powerW.read()).toBe("180 W");
    expect(targets.cadenceRpm.read()).toBe("92 rpm");
    expect(targets.heartRateBpm.read()).toBe("132 bpm");
    expect(targets.gear.read()).toBe("1");
    expect(targets.status.read()).toBe("Waiting for devices");
    expect(targets.speed.read()).toBe("30.4 km/h");
    expect(targets.distance.read()).toBe("12.35 km");
    expect(targets.elevationGain.read()).toBe("210 m");
    expect(targets.energy.read()).toBe("641 kJ");
    expect(targets.warning.read()).toBe("");
  });
});
