import type { Bpm, FunItemId, Mps, Pct, RideMode, Seconds, Meters } from "@voltonaut/shared";

import type { CommandGateState } from "../trainer/commands.js";
import { createCommandGateState } from "../trainer/commands.js";

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
  /** Fun mode (spec E9-01); "normal" never touches the item fields. */
  mode: RideMode;
  heldItem: FunItemId | undefined;
  activeItem: FunItemId | undefined;
  activeRemainingS: Seconds;
  /** mulberry32 state; item contents are drawn from the ride seed only. */
  rngState: number;
}

export interface RideStateInit {
  readonly gearIndex: number;
  readonly gearRatio: number;
  readonly speedMps: Mps;
  readonly routePosM: Meters;
  readonly mode: RideMode;
  /** Seed for item box contents (mulberry32 state). */
  readonly seed: number;
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
    mode: init.mode,
    heldItem: undefined,
    activeItem: undefined,
    activeRemainingS: 0,
    rngState: init.seed >>> 0,
  };
}
