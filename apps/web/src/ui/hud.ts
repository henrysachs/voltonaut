import { gearLabel } from "@voltonaut/rules";

import type { HudState } from "../game/simRide.js";

export interface HudText {
  readonly powerW: string;
  readonly cadenceRpm: string;
  readonly heartRateBpm: string;
  readonly gear: string;
  readonly status: string;
}

export interface TextTarget {
  textContent: string;
}

export interface HudTargets {
  readonly powerW: TextTarget;
  readonly cadenceRpm: TextTarget;
  readonly heartRateBpm: TextTarget;
  readonly gear: TextTarget;
  readonly status: TextTarget;
}

export function hudText(state: HudState): HudText {
  return {
    powerW: `${Math.round(state.powerW)} W`,
    cadenceRpm: `${Math.round(state.cadenceRpm)} rpm`,
    heartRateBpm: `${Math.round(state.heartRateBpm)} bpm`,
    gear: gearLabel(state.gearIndex),
    status: state.connected ? "Sim connected" : "Waiting for devices",
  };
}

export function renderHud(state: HudState, targets: HudTargets): void {
  const text = hudText(state);
  targets.powerW.textContent = text.powerW;
  targets.cadenceRpm.textContent = text.cadenceRpm;
  targets.heartRateBpm.textContent = text.heartRateBpm;
  targets.gear.textContent = text.gear;
  targets.status.textContent = text.status;
}
