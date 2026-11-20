import { gearLabel } from "@voltonaut/rules";

import type { HudState } from "../game/simRide.js";

export interface HudText {
  readonly powerW: string;
  readonly cadenceRpm: string;
  readonly heartRateBpm: string;
  readonly gear: string;
  readonly status: string;
}

/** Sink for one HUD value. DOM adapters write the text into the real element. */
export interface TextTarget {
  readonly write: (text: string) => void;
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
  targets.powerW.write(text.powerW);
  targets.cadenceRpm.write(text.cadenceRpm);
  targets.heartRateBpm.write(text.heartRateBpm);
  targets.gear.write(text.gear);
  targets.status.write(text.status);
}
