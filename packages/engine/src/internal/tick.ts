import type { Meters, RideEvent, Seconds, TickInputs, TrainerCommand } from "@voltonaut/shared";

import type { EngineRoute } from "../elevation/route.js";
import { advanceSpeedMps } from "../physics/integrate.js";
import type { RiderParams } from "../physics/params.js";
import { nextCommand as computeNextCommand } from "../trainer/commands.js";
import type { RideState } from "./state.js";
import { isStationary, rawValuesZeroed, shouldAutoPause, shouldResume } from "./autopause.js";
import { elevationGainDeltaM, energyDeltaKj, routePositionM } from "./sums.js";

/** Immutable per-ride context: route, frozen rider params, gear data, trainer mass. */
export interface EngineContext {
  readonly route: EngineRoute;
  readonly riderParams: RiderParams;
  readonly gearRatios: readonly number[];
  readonly physicalRatio: number;
  readonly trainerMassKg: number;
}

export interface TickResult {
  readonly state: RideState;
  readonly events: readonly RideEvent[];
  readonly trainerCommand: TrainerCommand | undefined;
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

function crossedBoundaryM(
  previousM: Meters,
  nextM: Meters,
  boundaryM: Meters,
  loop: boolean,
): boolean {
  if (!loop || nextM >= previousM) {
    return boundaryM > previousM && boundaryM <= nextM;
  }

  // Wrapped tick: the rider passed (previousM, L] and [0, nextM].
  return boundaryM > previousM || boundaryM <= nextM;
}

function applySegments(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it (depcruise engine-internal-private).
  state: RideState,
  route: EngineRoute,
  previousRoutePosM: Meters,
  nextRoutePosM: Meters,
  tS: Seconds,
): readonly RideEvent[] {
  const events: RideEvent[] = [];

  for (const segment of route.segments) {
    const crossedStart = crossedBoundaryM(
      previousRoutePosM,
      nextRoutePosM,
      segment.startM,
      route.loop,
    );

    const crossedEnd = crossedBoundaryM(previousRoutePosM, nextRoutePosM, segment.endM, route.loop);
    const active = state.activeSegments.includes(segment.id);

    if (crossedStart && !active) {
      state.activeSegments.push(segment.id);
      events.push({ type: "segment.entered", segmentId: segment.id, tS });
    }

    if (crossedEnd && state.activeSegments.includes(segment.id)) {
      state.activeSegments = state.activeSegments.filter((id) => id !== segment.id);
      events.push({ type: "segment.exited", segmentId: segment.id, tS });
    }
  }

  return events;
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
): void {
  state.gradePct = ctx.route.profile.gradeAt(state.routePosM);

  state.speedMps = advanceSpeedMps(
    state.speedMps,
    state.gradePct,
    rawPowerW,
    ctx.riderParams,
    0,
    dtS,
  );

  const previousRoutePosM = state.routePosM;
  const deltaM = state.speedMps * dtS;

  state.distanceM += deltaM;
  state.routePosM = routePositionM(state.distanceM, ctx.route.lengthM, ctx.route.loop);
  state.tS += dtS;
  state.energyKj += energyDeltaKj(rawPowerW, dtS);

  const previousElevationM = ctx.route.profile.elevationAt(previousRoutePosM);
  const nextElevationM = ctx.route.profile.elevationAt(state.routePosM);
  const deltaElevM = nextElevationM - previousElevationM;

  state.elevationGainM += elevationGainDeltaM(previousElevationM, nextElevationM);

  if (deltaM > 0) {
    events.push({ type: "distance.tick", deltaM, deltaElevM });
  }

  if (ctx.route.loop && state.routePosM < previousRoutePosM) {
    state.lap += 1;
    events.push({ type: "lap.completed", lap: state.lap, tS: state.tS });
  }

  events.push(...applySegments(state, ctx.route, previousRoutePosM, state.routePosM, state.tS));
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

  const pause = applyPause(state, raw);

  if (pause === "paused") {
    return { state, events, trainerCommand: undefined };
  }

  advanceRide(state, ctx, raw.powerW, dtS, events);

  if (isStationary(state.speedMps, raw.cadenceRpm)) {
    state.stationaryS += dtS;
  } else {
    state.stationaryS = 0;
  }

  const trainerCommand = computeNextCommand({
    gate: state.commandGate,
    tickIndex: state.tickIndex,
    immediate: gearChanged || pause === "resumed",
    cadenceRpm: raw.cadenceRpm,
    routeGradePct: state.gradePct,
    gearRatio: state.gearRatio,
    physicalRatio: ctx.physicalRatio,
    riderParams: ctx.riderParams,
    trainerMassKg: ctx.trainerMassKg,
  });

  state.tickIndex += 1;

  return { state, events, trainerCommand };
}
