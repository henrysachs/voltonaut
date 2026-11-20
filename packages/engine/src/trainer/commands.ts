import type { Pct, Rpm } from "@voltonaut/shared";

import type { TrainerCommand } from "@voltonaut/shared";

import type { RiderParams } from "../physics/params.js";
import { effectiveGradePct, simulationCommand } from "./gradeMap.js";

/** Max one regular command per 5 ticks (20 Hz engine => 4 Hz trainer commands). */
export const COMMAND_INTERVAL_TICKS = 5;

/** Only re-send when the effective grade moved at least this much (docs/03 section 4). */
export const GRADE_DELTA_THRESHOLD_PCT = 0.1;

/** Mutable rate-limiter state; owned by the internal RideState. */
export interface CommandGateState {
  /** Tick index of the last emitted command; starts re-armed for tick 0. */
  lastCommandTick: number;
  /** Last sent effective grade; undefined before the first command. */
  lastSentGradePct: Pct | undefined;
}

export function createCommandGateState(): CommandGateState {
  return { lastCommandTick: -COMMAND_INTERVAL_TICKS, lastSentGradePct: undefined };
}

export interface CommandDecisionInputs {
  readonly gate: CommandGateState;
  readonly tickIndex: number;
  /** Gear changed or ride resumed on this tick: bypass interval and delta. */
  readonly immediate: boolean;
  readonly cadenceRpm: Rpm;
  /** Effective grade that would be sent now. */
  readonly gradeEffPct: Pct;
}

/** Pure send/hold decision for one tick; the caller applies the gate update on send. */
export function commandDue(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the gate is the rate-limit state that nextCommand updates by design.
  inputs: CommandDecisionInputs,
): boolean {
  if (inputs.cadenceRpm <= 0) {
    return false;
  }

  if (inputs.immediate) {
    return true;
  }

  if (inputs.gate.lastSentGradePct === undefined) {
    return inputs.tickIndex - inputs.gate.lastCommandTick >= COMMAND_INTERVAL_TICKS;
  }

  return (
    inputs.tickIndex - inputs.gate.lastCommandTick >= COMMAND_INTERVAL_TICKS &&
    Math.abs(inputs.gradeEffPct - inputs.gate.lastSentGradePct) >= GRADE_DELTA_THRESHOLD_PCT
  );
}

export interface CommandInputs {
  readonly gate: CommandGateState;
  readonly tickIndex: number;
  readonly immediate: boolean;
  readonly cadenceRpm: Rpm;
  readonly routeGradePct: Pct;
  readonly gearRatio: number;
  readonly physicalRatio: number;
  readonly riderParams: RiderParams;
  readonly trainerMassKg: number;
}

/**
 * Computes the next trainer command for one tick and applies the rate limit.
 * Returns undefined when the previous grade is held.
 */
export function nextCommand(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the gate is the rate-limit state this function updates by design.
  inputs: CommandInputs,
): TrainerCommand | undefined {
  const gradeEffPct = effectiveGradePct({
    cadenceRpm: inputs.cadenceRpm,
    gearRatio: inputs.gearRatio,
    physicalRatio: inputs.physicalRatio,
    routeGradePct: inputs.routeGradePct,
    riderParams: inputs.riderParams,
    trainerMassKg: inputs.trainerMassKg,
  });

  const due = commandDue({
    gate: inputs.gate,
    tickIndex: inputs.tickIndex,
    immediate: inputs.immediate,
    cadenceRpm: inputs.cadenceRpm,
    gradeEffPct,
  });

  if (!due) {
    return undefined;
  }

  inputs.gate.lastCommandTick = inputs.tickIndex;
  inputs.gate.lastSentGradePct = gradeEffPct;

  return simulationCommand(gradeEffPct, inputs.riderParams);
}
