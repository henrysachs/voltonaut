import { describe, expect, it } from "vitest";

import type { HudState } from "../game/simRide.js";

import type { HudTargets, TextTarget } from "./hud.js";
import { hudText, renderHud } from "./hud.js";

function target(): TextTarget & { read: () => string } {
  let text = "";

  return {
    write: (value: string): void => {
      text = value;
    },
    read: () => text,
  };
}

function state(overrides: Partial<HudState> = {}): HudState {
  return {
    powerW: 180.4,
    cadenceRpm: 92.2,
    heartRateBpm: 131.6,
    gearIndex: 3,
    connected: true,
    ...overrides,
  };
}

describe("HUD", () => {
  it("formats all values and shows the one-based gear", () => {
    expect(hudText(state())).toEqual({
      powerW: "180 W",
      cadenceRpm: "92 rpm",
      heartRateBpm: "132 bpm",
      gear: "4",
      status: "Sim connected",
    });
  });

  it("shows a waiting status when no device is connected", () => {
    const text = hudText(state({ connected: false }));

    expect(text.status).toBe("Waiting for devices");
  });

  it("writes every formatted value into its target", () => {
    const targets = {
      powerW: target(),
      cadenceRpm: target(),
      heartRateBpm: target(),
      gear: target(),
      status: target(),
    } satisfies HudTargets;

    renderHud(state({ gearIndex: 0, connected: false }), targets);

    expect(targets.powerW.read()).toBe("180 W");
    expect(targets.cadenceRpm.read()).toBe("92 rpm");
    expect(targets.heartRateBpm.read()).toBe("132 bpm");
    expect(targets.gear.read()).toBe("1");
    expect(targets.status.read()).toBe("Waiting for devices");
  });
});
