import type {
  DeviceEvent,
  FunItemId,
  Meters,
  Mps,
  NativeTickFacts,
  RideEvent,
  RideMode,
  RiderProfile,
  Seconds,
  TickInputs,
  TrainerCommand,
} from "@voltonaut/shared";

import type { EngineRoute } from "../elevation/route.js";
import { GEAR_PRESETS, physicalRatioFor, START_GEAR_INDEX } from "../gears/presets.js";
import { planItemBoxes } from "../fun/itemBoxes.js";
import { DEFAULT_TRAINER_MASS_KG } from "../trainer/gradeMap.js";
import { riderParamsFromProfile } from "../physics/params.js";
import { planCatchup, TICK_S } from "./catchup.js";
import type { EngineContext } from "./tick.js";
import { tick } from "./tick.js";
import { createRideState, type RideState } from "./state.js";

export type { NativeTickFacts } from "@voltonaut/shared";

/** Default item seed (spec E9-01 AK3). */
export const DEFAULT_FUN_SEED = 42;

/** Fun mode view (spec E9-01); undefined in normal mode. */
export interface FunSnapshot {
  readonly heldItem: FunItemId | undefined;
  readonly activeItem: FunItemId | undefined;
  readonly activeRemainingS: Seconds;
}

/** Public read-only view of the ride; frozen at every snapshot() call. */
export interface RideSnapshot {
  readonly tS: Seconds;
  readonly distanceM: Meters;
  readonly routePosM: Meters;
  readonly lap: number;
  readonly speedMps: Mps;
  readonly powerW: number;
  readonly cadenceRpm: number;
  readonly hrBpm: number | undefined;
  readonly gradePct: number;
  readonly gear: { readonly index: number; readonly ratio: number };
  readonly elevationGainM: Meters;
  readonly energyKj: number;
  readonly paused: boolean;
  readonly dataAgeS: Seconds;
  readonly trainerMode: "simulation";
  readonly worldPos: { readonly x: number; readonly y: number; readonly z: number };
  readonly headingRad: number;
  readonly fun: FunSnapshot | undefined;
}

export interface CreateEngineOptions {
  readonly route: EngineRoute;
  /** Rider parameters are frozen at ride start; profile edits apply to the next ride. */
  readonly profile: RiderProfile;
  readonly initialGearIndex?: number;
  readonly initialSpeedMps?: number;
  readonly initialRoutePosM?: number;
  /** Trainer-internal mass assumption (mT); default 83 kg, calibrated in E2. */
  readonly trainerMassKg?: number;
  /** Initial ride mode; default "normal". */
  readonly mode?: RideMode;
  /** Seed for item box contents; default 42. */
  readonly seed?: number;
}

export interface Engine {
  /** Buffers the latest device readings; zero-order hold between events. */
  readonly ingest: (event: DeviceEvent) => void;
  /**
   * Feeds elapsed seconds into the accumulator and runs floor(elapsed / 0.05)
   * ticks, capped at 120 (6 s); excess gaps emit ride.clockSkipped and the
   * data-loss rule takes over (rolling out instead of standing still).
   * Returns one immutable fact per processed tick in native order.
   */
  readonly advance: (elapsedS: Seconds) => readonly NativeTickFacts[];
  readonly snapshot: () => RideSnapshot;
  readonly drainEvents: () => readonly RideEvent[];
  readonly drainCommands: () => readonly TrainerCommand[];
  /** Mode intent; takes effect on the next tick. */
  readonly setMode: (mode: RideMode) => void;
}

interface BufferedInputs {
  powerW: number;
  cadenceRpm: number;
  hrBpm: number | undefined;
  shifts: number;
  trainerDataFresh: boolean;
  useItem: boolean;
  mode: RideMode;
}

function frozenWorldPos(route: EngineRoute, routePosM: Meters): RideSnapshot["worldPos"] {
  const position = route.worldPos(routePosM);

  return Object.freeze({ x: position.x, y: position.y, z: position.z });
}

function contextFrom(options: CreateEngineOptions): EngineContext {
  const preset = GEAR_PRESETS[options.profile.gearPreset];

  return {
    route: options.route,
    riderParams: riderParamsFromProfile(options.profile),
    gearRatios: preset.ratios,
    physicalRatio: physicalRatioFor(
      options.profile.bike.chainringTeeth,
      options.profile.bike.cogTeeth,
    ),
    trainerMassKg: options.trainerMassKg ?? DEFAULT_TRAINER_MASS_KG,
    itemBoxesM: planItemBoxes(options.route),
  };
}

class RideEngine implements Engine {
  private readonly ctx: EngineContext;
  private state: RideState;
  private pendingS = 0;
  private started = false;
  private events: RideEvent[] = [];
  private commands: TrainerCommand[] = [];
  private buffered: BufferedInputs = {
    powerW: 0,
    cadenceRpm: 0,
    hrBpm: undefined,
    shifts: 0,
    trainerDataFresh: false,
    useItem: false,
    mode: "normal",
  };

  constructor(options: CreateEngineOptions) {
    this.ctx = contextFrom(options);

    const gearIndex = options.initialGearIndex ?? START_GEAR_INDEX;

    this.state = createRideState({
      gearIndex,
      gearRatio: this.ctx.gearRatios[gearIndex] ?? this.ctx.gearRatios[0] ?? 1,
      speedMps: options.initialSpeedMps ?? 0,
      routePosM: options.initialRoutePosM ?? 0,
      mode: options.mode ?? "normal",
      seed: options.seed ?? DEFAULT_FUN_SEED,
    });
    this.buffered = { ...this.buffered, mode: this.state.mode };
  }

  readonly ingest = (event: DeviceEvent): void => {
    if (event.type === "trainer.data") {
      this.buffered = {
        ...this.buffered,
        powerW: event.powerW ?? this.buffered.powerW,
        cadenceRpm: event.cadenceRpm ?? this.buffered.cadenceRpm,
        trainerDataFresh: true,
      };

      return;
    }

    if (event.type === "hr.data") {
      this.buffered = { ...this.buffered, hrBpm: event.bpm };

      return;
    }

    if (event.type === "controller.button" && event.pressed) {
      if (event.button === "shiftUp") {
        this.buffered = { ...this.buffered, shifts: this.buffered.shifts + 1 };
      } else if (event.button === "shiftDown") {
        this.buffered = { ...this.buffered, shifts: this.buffered.shifts - 1 };
      } else if (event.button === "powerUp") {
        this.buffered = { ...this.buffered, useItem: true };
      }
    }
  };

  /** Inputs for the next tick; one-shot intents are consumed by exactly one tick. */
  private takeInputs(): TickInputs {
    const inputs: TickInputs = {
      powerW: this.buffered.powerW,
      cadenceRpm: this.buffered.cadenceRpm,
      hrBpm: this.buffered.hrBpm,
      shifts: this.buffered.shifts,
      trainerDataFresh: this.buffered.trainerDataFresh,
      useItem: this.buffered.useItem,
      mode: this.buffered.mode,
    };

    this.buffered = { ...this.buffered, shifts: 0, trainerDataFresh: false, useItem: false };

    return inputs;
  }

  readonly advance = (elapsedS: Seconds): readonly NativeTickFacts[] => {
    const facts: NativeTickFacts[] = [];

    if (!this.started) {
      this.started = true;
      this.events.push({ type: "ride.started" });
    }

    if (elapsedS > 0 && Number.isFinite(elapsedS)) {
      this.pendingS += elapsedS;
    }

    const plan = planCatchup(this.pendingS);

    if (plan.skippedS > 0) {
      this.events.push({ type: "ride.clockSkipped", skippedS: plan.skippedS });
      this.pendingS = 0;
    } else {
      this.pendingS -= plan.ticksToRun * TICK_S;
    }

    for (let tickNumber = 0; tickNumber < plan.ticksToRun; tickNumber += 1) {
      const result = tick(this.state, this.takeInputs(), this.ctx, TICK_S);

      this.state = result.state;
      facts.push(result.facts);

      if (result.trainerCommand !== undefined) {
        this.commands.push(result.trainerCommand);
      }

      this.events.push(...result.events);
    }

    return Object.freeze(facts);
  };

  readonly snapshot = (): RideSnapshot => {
    const state = this.state;

    return Object.freeze({
      tS: state.tS,
      distanceM: state.distanceM,
      routePosM: state.routePosM,
      lap: state.lap,
      speedMps: state.speedMps,
      powerW: state.powerW,
      cadenceRpm: state.cadenceRpm,
      hrBpm: state.hrBpm,
      gradePct: state.gradePct,
      gear: Object.freeze({ index: state.gearIndex, ratio: state.gearRatio }),
      elevationGainM: state.elevationGainM,
      energyKj: state.energyKj,
      paused: state.paused,
      dataAgeS: state.dataAgeS,
      trainerMode: "simulation",
      worldPos: frozenWorldPos(this.ctx.route, state.routePosM),
      headingRad: this.ctx.route.headingRad(state.routePosM),
      fun:
        state.mode === "fun"
          ? Object.freeze({
              heldItem: state.heldItem,
              activeItem: state.activeItem,
              activeRemainingS: state.activeRemainingS,
            })
          : undefined,
    });
  };

  readonly drainEvents = (): readonly RideEvent[] => {
    const drained = this.events;

    this.events = [];

    return drained;
  };

  readonly setMode = (mode: RideMode): void => {
    this.buffered = { ...this.buffered, mode };
  };

  readonly drainCommands = (): readonly TrainerCommand[] => {
    const drained = this.commands;

    this.commands = [];

    return drained;
  };
}

export function createEngine(options: CreateEngineOptions): Engine {
  return new RideEngine(options);
}
