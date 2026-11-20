import { describe, expect, it } from "vitest";

import { DEFAULT_RIDER_PARAMS } from "../physics/params.js";
import type { CommandInputs } from "./commands.js";
import {
  COMMAND_INTERVAL_TICKS,
  commandDue,
  createCommandGateState,
  GRADE_DELTA_THRESHOLD_PCT,
  nextCommand,
} from "./commands.js";

type CommandInputsOverrides = Readonly<Partial<CommandInputs>>;

function inputs(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the overrides deliberately carry the mutable command gate for the rate-limit tests.
  overrides: CommandInputsOverrides = {},
) {
  return {
    gate: createCommandGateState(),
    tickIndex: 0,
    immediate: false,
    cadenceRpm: 90,
    routeGradePct: 0,
    gearRatio: 2.3,
    physicalRatio: 3,
    riderParams: DEFAULT_RIDER_PARAMS,
    trainerMassKg: 83,
    ...overrides,
  };
}

describe("commandDue initial and immediate commands", () => {
  it("sends the first command at tick 0 (interval starts re-armed)", () => {
    expect(
      commandDue({
        ...inputs(),
        gate: createCommandGateState(),
        tickIndex: 0,
        immediate: false,
        cadenceRpm: 90,
        gradeEffPct: 0,
      }),
    ).toBe(true);
  });

  it("holds when cadence is zero, even immediately after a gear change", () => {
    expect(
      commandDue({
        ...inputs(),
        gate: createCommandGateState(),
        immediate: true,
        cadenceRpm: 0,
        gradeEffPct: 1,
      }),
    ).toBe(false);
  });

  it("bypasses the interval and delta on immediate ticks", () => {
    const gate = createCommandGateState();

    gate.lastCommandTick = 3;
    gate.lastSentGradePct = 5;

    expect(
      commandDue({
        ...inputs(),
        gate,
        tickIndex: 4,
        immediate: true,
        cadenceRpm: 90,
        gradeEffPct: 5.01,
      }),
    ).toBe(true);
  });
});

describe("commandDue interval and delta", () => {
  it("requires five ticks since the last command and a delta >= 0.1 %", () => {
    const gate = createCommandGateState();

    gate.lastCommandTick = 0;
    gate.lastSentGradePct = 0;

    const fourTicks = commandDue({
      ...inputs(),
      gate,
      tickIndex: 4,
      immediate: false,
      cadenceRpm: 90,
      gradeEffPct: 9,
    });

    const fiveTicksSmallDelta = commandDue({
      ...inputs(),
      gate,
      tickIndex: 5,
      immediate: false,
      cadenceRpm: 90,
      gradeEffPct: 0.05,
    });

    const fiveTicksDelta = commandDue({
      ...inputs(),
      gate,
      tickIndex: 5,
      immediate: false,
      cadenceRpm: 90,
      gradeEffPct: 0.1,
    });

    expect(COMMAND_INTERVAL_TICKS).toBe(5);
    expect(GRADE_DELTA_THRESHOLD_PCT).toBe(0.1);
    expect(fourTicks).toBe(false);
    expect(fiveTicksSmallDelta).toBe(false);
    expect(fiveTicksDelta).toBe(true);
  });
});

describe("nextCommand", () => {
  it("emits a simulation command and re-arms the gate", () => {
    const gate = createCommandGateState();

    const command = nextCommand({ ...inputs(), gate, tickIndex: 0 });

    expect(command?.type).toBe("simulation");
    expect(gate.lastCommandTick).toBe(0);
    expect(gate.lastSentGradePct).toBeDefined();
  });

  it("holds the grade once the interval has not elapsed again", () => {
    const gate = createCommandGateState();

    nextCommand({ ...inputs(), gate, tickIndex: 0 });
    const second = nextCommand({ ...inputs(), gate, tickIndex: 2, routeGradePct: 8 });

    expect(second).toBeUndefined();
  });

  it("never emits without cadence", () => {
    expect(nextCommand({ ...inputs(), cadenceRpm: 0, routeGradePct: 8 })).toBeUndefined();
  });
});
