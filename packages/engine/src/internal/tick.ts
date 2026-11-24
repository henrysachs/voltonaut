import type {
  Meters,
  NativeTickFacts,
  RideEvent,
  Seconds,
  TickInputs,
  TrainerCommand,
} from "@voltonaut/shared";

import type { EngineRoute } from "../elevation/route.js";
import type { RiderParams } from "../physics/params.js";
import { nextCommand as computeNextCommand } from "../trainer/commands.js";
import type { RideState } from "./state.js";
import { isStationary, rawValuesZeroed, shouldAutoPause, shouldResume } from "./autopause.js";
import { afterAdvance, applyFunIntents, nextSpeedMps } from "./funTick.js";
import { applySegments } from "./segments.js";
import { elevationGainDeltaM, energyDeltaKj, routePositionM } from "./sums.js";

/** Immutable per-ride context: route, frozen rider params, gear data, trainer mass. */
export interface EngineContext {
  readonly route: EngineRoute;
  readonly riderParams: RiderParams;
  readonly gearRatios: readonly number[];
  readonly physicalRatio: number;
  readonly trainerMassKg: number;
  /** Item box positions; only used in fun mode (spec E9-01). */
  readonly itemBoxesM: readonly Meters[];
}

interface TickContributions {
  readonly timeS: Seconds;
  readonly distanceM: Meters;
  readonly elevationGainM: Meters;
  readonly energyKj: number;
}

function nativeFacts(
  raw: Readonly<RawReadings>,
  contributions: TickContributions,
): NativeTickFacts {
  return Object.freeze({
    powerW: raw.powerW,
    cadenceRpm: raw.cadenceRpm,
    ...contributions,
  });
}

function pausedFacts(raw: Readonly<RawReadings>): NativeTickFacts {
  return nativeFacts(raw, { timeS: 0, distanceM: 0, elevationGainM: 0, energyKj: 0 });
}

export interface TickResult {
  readonly state: RideState;
  readonly events: readonly RideEvent[];
  readonly trainerCommand: TrainerCommand | undefined;
  readonly facts: NativeTickFacts;
}

const EMA_TAU_S: Seconds = 1;

interface RawReadings {
  readonly powerW: number;
  readonly cadenceRpm: number;
}

function emaAlpha(dtS: Seconds): number {
  return 1 - Math.exp(-dtS / EMA_TAU_S);
}

function clampGearIndex(index: number, gearCount: number): number {
  return Math.min(gearCount - 1, Math.max(0, index));
}

/** Step 1: shift intents, gear clamped into [1, gearCount] (zero-based). */
function applyShifts(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This internal writer applies shift intents to engine-owned state.
  state: RideState,
  shifts: number,
  gearRatios: readonly number[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives the emitted gear change.
  events: RideEvent[],
): boolean {
  const nextGearIndex = clampGearIndex(state.gearIndex + shifts, gearRatios.length);
  const gearChanged = nextGearIndex !== state.gearIndex;

  if (gearChanged) {
    events.push({ type: "gear.changed", from: state.gearIndex, to: nextGearIndex });
    state.gearIndex = nextGearIndex;
    state.gearRatio = gearRatios[nextGearIndex] ?? state.gearRatio;
  }

  return gearChanged;
}

/** Step 2: data age + raw readings; display values get the 1 s EMA. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This internal writer updates data age and display measurements on engine-owned state.
function applyMeasurements(state: RideState, inputs: TickInputs, dtS: Seconds): RawReadings {
  if (inputs.trainerDataFresh) {
    state.dataAgeS = 0;
  } else {
    state.dataAgeS += dtS;
  }

  let rawPowerW = inputs.powerW;
  let rawCadenceRpm = inputs.cadenceRpm;

  if (rawValuesZeroed(state.dataAgeS)) {
    rawPowerW = 0;
    rawCadenceRpm = 0;
  }

  const alpha = emaAlpha(dtS);

  state.powerW += alpha * (rawPowerW - state.powerW);
  state.cadenceRpm += alpha * (rawCadenceRpm - state.cadenceRpm);

  if (inputs.hrBpm !== undefined) {
    state.hrBpm =
      state.hrBpm === undefined ? inputs.hrBpm : state.hrBpm + alpha * (inputs.hrBpm - state.hrBpm);
  }

  return { powerW: rawPowerW, cadenceRpm: rawCadenceRpm };
}

/** Steps 4-6: grade, Euler speed step, odometer, sums, lap and segment events. */
function advanceRide(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it (depcruise engine-internal-private).
  state: RideState,
  ctx: EngineContext,
  rawPowerW: number,
  dtS: Seconds,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The tick's event accumulator receives distance, lap and segment events.
  events: RideEvent[],
): TickContributions {
  state.gradePct = ctx.route.profile.gradeAt(state.routePosM);

  state.speedMps = nextSpeedMps(state, ctx.riderParams, rawPowerW, dtS);

  const previousRoutePosM = state.routePosM;
  const distanceM = state.speedMps * dtS;
  const energyKj = energyDeltaKj(rawPowerW, dtS);

  state.distanceM += distanceM;
  state.routePosM = routePositionM(state.distanceM, ctx.route.lengthM, ctx.route.loop);
  state.tS += dtS;
  state.energyKj += energyKj;

  const previousElevationM = ctx.route.profile.elevationAt(previousRoutePosM);
  const nextElevationM = ctx.route.profile.elevationAt(state.routePosM);
  const deltaElevM = nextElevationM - previousElevationM;
  const elevationGainM = elevationGainDeltaM(previousElevationM, nextElevationM);

  state.elevationGainM += elevationGainM;

  if (distanceM > 0) {
    events.push({ type: "distance.tick", deltaM: distanceM, deltaElevM });
  }

  if (ctx.route.loop && state.routePosM < previousRoutePosM) {
    state.lap += 1;
    events.push({ type: "lap.completed", lap: state.lap, tS: state.tS });
  }

  events.push(...applySegments(state, ctx.route, previousRoutePosM, state.routePosM, state.tS));

  return { timeS: dtS, distanceM, elevationGainM, energyKj };
}

function applyPause(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This internal writer owns auto-pause and resume transitions.
  state: RideState,
  raw: RawReadings,
): "running" | "paused" | "resumed" {
  if (state.paused) {
    if (!shouldResume(raw.cadenceRpm, raw.powerW)) {
      return "paused";
    }

    state.paused = false;
    state.stationaryS = 0;

    return "resumed";
  }

  if (shouldAutoPause(state.stationaryS, state.speedMps, raw.cadenceRpm)) {
    state.paused = true;
    state.stationaryS = 0;

    return "paused";
  }

  return "running";
}

/** Stationary seconds feed the auto-pause rule. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- This internal writer owns the stationary accumulator on engine-owned state.
function accumulateStationary(state: RideState, rawCadenceRpm: number, dtS: Seconds): void {
  state.stationaryS = isStationary(state.speedMps, rawCadenceRpm) ? state.stationaryS + dtS : 0;
}

/** Rate-limited trainer command from the profile params; items never reach it (ADR-027). */
function trainerCommandFor(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The command gate inside RideState is engine-owned mutable state; nextCommand advances it.
  state: RideState,
  ctx: EngineContext,
  cadenceRpm: number,
  immediate: boolean,
): TrainerCommand | undefined {
  return computeNextCommand({
    gate: state.commandGate,
    tickIndex: state.tickIndex,
    immediate,
    cadenceRpm,
    routeGradePct: state.gradePct,
    gearRatio: state.gearRatio,
    physicalRatio: ctx.physicalRatio,
    riderParams: ctx.riderParams,
    trainerMassKg: ctx.trainerMassKg,
  });
}

/**
 * One deterministic engine tick (docs/03 section 1). Order: shifts -> raw
 * readings + data age + display EMA -> auto-pause state machine -> grade ->
 * speed integration -> position/sums/segments/lap -> stationary accumulation ->
 * rate-limited trainer command.
 */
export function tick(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; tick is its single writer (docs/01 section "ein Besitzer pro State").
  state: RideState,
  inputs: TickInputs,
  ctx: EngineContext,
  dtS: Seconds,
): TickResult {
  const events: RideEvent[] = [];

  const gearChanged = applyShifts(state, inputs.shifts, ctx.gearRatios, events);

  const raw = applyMeasurements(state, inputs, dtS);

  applyFunIntents(state, inputs, events);

  const pause = applyPause(state, raw);

  if (pause === "paused") {
    return { state, events, trainerCommand: undefined, facts: pausedFacts(raw) };
  }

  const previousRoutePosM = state.routePosM;
  const contributions = advanceRide(state, ctx, raw.powerW, dtS, events);

  afterAdvance(
    state,
    { positionsM: ctx.itemBoxesM, loop: ctx.route.loop },
    previousRoutePosM,
    dtS,
    events,
  );

  const facts = nativeFacts(raw, contributions);

  accumulateStationary(state, raw.cadenceRpm, dtS);

  const trainerCommand = trainerCommandFor(
    state,
    ctx,
    raw.cadenceRpm,
    gearChanged || pause === "resumed",
  );

  state.tickIndex += 1;

  return { state, events, trainerCommand, facts };
}
