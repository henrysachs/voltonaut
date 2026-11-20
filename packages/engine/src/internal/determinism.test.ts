import { describe, expect, it } from "vitest";

import type { RideEvent, TrainerCommand } from "@voltonaut/shared";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute } from "../elevation/route.js";
import { createEngine, type Engine, type RideSnapshot } from "./engine.js";

/** Runs an identical input script twice and records one snapshot per second. */
function runScript() {
  const engine: Engine = createEngine({
    route: createRoute(TEST_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
    initialSpeedMps: 3,
  });

  const snapshots: RideSnapshot[] = [];

  for (let second = 0; second < 12; second += 1) {
    engine.ingest({
      type: "trainer.data",
      tS: second,
      powerW: 150 + (second % 3) * 40,
      cadenceRpm: 90,
    });
    engine.ingest({ type: "hr.data", tS: second, bpm: 130 + (second % 2) * 5 });

    if (second === 4) {
      engine.ingest({
        type: "controller.button",
        tS: second,
        button: "shiftUp",
        pressed: true,
        source: "test",
      });
      engine.ingest({
        type: "controller.button",
        tS: second,
        button: "shiftUp",
        pressed: false,
        source: "test",
      });
    }

    engine.advance(1);
    snapshots.push(engine.snapshot());
  }

  return { snapshots, events: [...engine.drainEvents()], commands: [...engine.drainCommands()] };
}

const DECIMALS = 1_000_000;

function canonical(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function canonicalSnapshot(snapshot: RideSnapshot): RideSnapshot {
  return {
    ...snapshot,
    tS: canonical(snapshot.tS),
    distanceM: canonical(snapshot.distanceM),
    routePosM: canonical(snapshot.routePosM),
    speedMps: canonical(snapshot.speedMps),
    powerW: canonical(snapshot.powerW),
    cadenceRpm: canonical(snapshot.cadenceRpm),
    hrBpm: snapshot.hrBpm === undefined ? undefined : canonical(snapshot.hrBpm),
    gradePct: canonical(snapshot.gradePct),
    gear: { index: snapshot.gear.index, ratio: canonical(snapshot.gear.ratio) },
    elevationGainM: canonical(snapshot.elevationGainM),
    energyKj: canonical(snapshot.energyKj),
    dataAgeS: canonical(snapshot.dataAgeS),
    worldPos: {
      x: canonical(snapshot.worldPos.x),
      y: canonical(snapshot.worldPos.y),
      z: canonical(snapshot.worldPos.z),
    },
    headingRad: canonical(snapshot.headingRad),
  };
}

function canonicalCommand(command: TrainerCommand): TrainerCommand {
  if (command.type !== "simulation") {
    return command;
  }

  return {
    ...command,
    gradePct: canonical(command.gradePct),
    windMps: canonical(command.windMps),
    crr: canonical(command.crr),
    cwKgPerM: canonical(command.cwKgPerM),
  };
}

function canonicalEvent(event: RideEvent): RideEvent {
  if (event.type === "distance.tick") {
    return { ...event, deltaM: canonical(event.deltaM), deltaElevM: canonical(event.deltaElevM) };
  }

  if (
    event.type === "segment.entered" ||
    event.type === "segment.exited" ||
    event.type === "lap.completed"
  ) {
    return { ...event, tS: canonical(event.tS) };
  }

  if (event.type === "ride.clockSkipped") {
    return { ...event, skippedS: canonical(event.skippedS) };
  }

  return event;
}

describe("determinism", () => {
  it("produces bit-identical snapshots, events and commands for identical scripts", () => {
    const first = runScript();
    const second = runScript();

    expect(first.snapshots.map(canonicalSnapshot)).toEqual(second.snapshots.map(canonicalSnapshot));
    expect(first.events.map(canonicalEvent)).toEqual(second.events.map(canonicalEvent));
    expect(first.commands.map(canonicalCommand)).toEqual(second.commands.map(canonicalCommand));
  });

  it("emits ride.started exactly once per engine", () => {
    const run = runScript();

    expect(run.events.filter((event) => event.type === "ride.started")).toHaveLength(1);
  });

  it("freezes snapshots so writes throw in strict mode", () => {
    const { snapshots } = runScript();
    const snapshot = snapshots.at(0);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.gear)).toBe(true);
    expect(Object.isFrozen(snapshot.worldPos)).toBe(true);

    expect(() => {
      Object.defineProperty(snapshot, "tS", { value: 999 });
    }).toThrow(TypeError);
  });
});
