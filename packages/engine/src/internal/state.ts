import type { Bpm, FunItemId, Mps, Pct, RideMode, Seconds, Meters } from "@voltonaut/shared";

import type { CommandGateState } from "../trainer/commands.js";
import { createCommandGateState } from "../trainer/commands.js";

/** Item slot of the fun ride mode (spec E9-01). */
export interface FunModeState {
  readonly kind: "fun";
  heldItem: FunItemId | undefined;
  activeItem: FunItemId | undefined;
  activeRemainingS: Seconds;
}

/**
 * Per-mode state (ADR-028). Each mode owns exactly its own fields, so normal mode
 * cannot hold an item. A mode switch replaces the whole slice.
 */
export type ModeState = { readonly kind: "normal" } | FunModeState;

/**
 * Mutable ride state. Only packages/engine/src/internal/** may touch it
 * (dependency-cruiser rule engine-internal-private); everything else reads
 * frozen RideSnapshot copies.
 */
export interface RideState {
  tS: Seconds;
  distanceM: Meters;
  routePosM: Meters;
  lap: number;
  speedMps: Mps;
  /** Display values (EMA-smoothed); physics uses the raw tick inputs. */
  powerW: number;
  cadenceRpm: number;
  hrBpm: Bpm | undefined;
  gradePct: Pct;
  gearIndex: number;
  gearRatio: number;
  elevationGainM: Meters;
  energyKj: number;
  paused: boolean;
  /** Seconds since the last fresh trainer.data event. */
  dataAgeS: Seconds;
  /** Consecutive stationary seconds (speed < 0.5 m/s and no cadence). */
  stationaryS: Seconds;
  /** Number of processed (non-frozen) ticks; drives the command rate limit. */
  tickIndex: number;
  commandGate: CommandGateState;
  /** Segment ids the rider is currently inside of. */
  activeSegments: string[];
  mode: ModeState;
  /**
   * mulberry32 state for seeded mode content; ride-wide, so leaving and
   * re-entering a mode continues the sequence instead of restarting it.
   */
  rngState: number;
}

export interface RideStateInit {
  readonly gearIndex: number;
  readonly gearRatio: number;
  readonly speedMps: Mps;
  readonly routePosM: Meters;
  readonly mode: RideMode;
  /** Seed for mode content such as item boxes (mulberry32 state). */
  readonly seed: number;
}

/** Fresh state slice of a mode, used at ride start and on every switch. */
export function initialModeState(mode: RideMode): ModeState {
  switch (mode) {
    case "normal":
      return { kind: "normal" };
    case "fun":
      return { kind: "fun", heldItem: undefined, activeItem: undefined, activeRemainingS: 0 };
    default: {
      const exhaustive: never = mode;

      return exhaustive;
    }
  }
}

export function createRideState(init: RideStateInit): RideState {
  return {
    tS: 0,
    distanceM: init.routePosM,
    routePosM: init.routePosM,
    lap: 0,
    speedMps: init.speedMps,
    powerW: 0,
    cadenceRpm: 0,
    hrBpm: undefined,
    gradePct: 0,
    gearIndex: init.gearIndex,
    gearRatio: init.gearRatio,
    elevationGainM: 0,
    energyKj: 0,
    paused: false,
    dataAgeS: 0,
    stationaryS: 0,
    tickIndex: 0,
    commandGate: createCommandGateState(),
    activeSegments: [],
    mode: initialModeState(init.mode),
    rngState: init.seed >>> 0,
  };
}
