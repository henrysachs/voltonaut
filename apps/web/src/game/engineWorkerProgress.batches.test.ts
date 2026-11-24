import { expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  RideProgressCheckpointSchema,
  type DeviceEvent,
  type NativeTickFacts,
} from "@voltonaut/shared";

import { bindEngineWorker, type EngineWorkerResponse } from "./engineWorkerCore.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const journalId = "550e8400-e29b-41d4-a716-446655440000";

type EngineUpdate = Extract<EngineWorkerResponse, { readonly type: "engine.update" }>;

function requireLatestUpdate(posted: readonly EngineWorkerResponse[]): EngineUpdate {
  const update = posted.findLast((message) => message.type === "engine.update");

  if (update === undefined || update.type !== "engine.update") {
    throw new Error("Expected an engine update");
  }

  return update;
}

function setupBatchWorker(clockScale: number) {
  const fake = createFakeScope();
  const clock = createManualClock();
  const timers = createFakeTimers();

  bindEngineWorker(fake.scope, clock.nowMs, timers.schedule, timers.cancel, 0, () => journalId);
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale,
  });

  return {
    ...fake,
    timers,
    wake: (elapsedMs: number) => {
      clock.advanceMs(elapsedMs);
      timers.tick();

      return requireLatestUpdate(fake.posted);
    },
  };
}

function hasPausedContributions(fact: NativeTickFacts): boolean {
  return (
    fact.timeS === 0 && fact.distanceM === 0 && fact.elevationGainM === 0 && fact.energyKj === 0
  );
}

it.each([
  { powerW: -16, cadenceRpm: 90, energyKj: -0.0008 },
  { powerW: 2500, cadenceRpm: 90, energyKj: 0.125 },
  { powerW: 200, cadenceRpm: 4_026_163_200, energyKj: 0.01 },
])(
  "projects $powerW W / $cadenceRpm rpm without stopping the recorder or update",
  ({
    powerW,
    cadenceRpm,
    energyKj,
  }: {
    readonly powerW: number;
    readonly cadenceRpm: number;
    readonly energyKj: number;
  }) => {
    const run = setupBatchWorker(1);

    run.timers.tick();
    run.send({
      type: "recording.command",
      actorId: "actor",
      requestId: 1,
      command: { kind: "start", rideId: journalId },
    });
    expect(run.posted.findLast((message) => message.type === "recording.reply")).toMatchObject({
      result: { kind: "state", view: { kind: "recording" } },
    });

    const reading = {
      type: "trainer.data",
      tS: 0,
      powerW,
      cadenceRpm,
    } satisfies DeviceEvent;

    run.send({ type: "engine.ingest", actorId: "actor", event: reading });
    const update = run.wake(50);

    expect(update.progress?.facts[0]).toMatchObject({ powerW, cadenceRpm, energyKj });
    expect(RideProgressCheckpointSchema.safeParse(update.progress).success).toBe(true);
    expect(update.recording).toMatchObject({
      kind: "recording",
      availability: { kind: "local_only", reason: "invalid_input" },
    });
    expect(run.posted.filter((message) => message.type === "engine.update")).toHaveLength(2);
  },
);

it("keeps the single freshness transition and terminal data age inside one batch", () => {
  const run = setupBatchWorker(20);

  run.send({
    type: "engine.ingest",
    actorId: "actor",
    event: { type: "trainer.data", tS: 0, powerW: 300, cadenceRpm: 80 },
  });
  run.timers.tick();
  const progress = run.wake(250).progress;

  expect(progress?.facts).toHaveLength(100);
  expect(progress?.facts[0]).toMatchObject({
    powerW: 300,
    cadenceRpm: 80,
    timeS: 0.05,
    energyKj: 0.015,
  });
  expect(progress?.facts.at(-1)).toMatchObject({
    powerW: 0,
    cadenceRpm: 0,
    timeS: 0.05,
    energyKj: 0,
  });
  expect(progress?.facts.every((fact) => fact.timeS === 0.05)).toBe(true);
  expect(progress?.quality).toMatchObject({ paused: false, clockSkipped: false });
  expect(progress?.quality?.dataAgeS).toBeCloseTo(4.95, 10);
});

it("keeps auto-pause entry facts zero and reports terminal paused quality", () => {
  const run = setupBatchWorker(20);

  run.timers.tick();
  const progress = run.wake(255).progress;

  expect(progress?.facts).toHaveLength(101);
  expect(progress?.facts[99]).toMatchObject({ timeS: 0.05 });
  expect(progress?.facts[100]).toEqual({
    powerW: 0,
    cadenceRpm: 0,
    timeS: 0,
    distanceM: 0,
    elevationGainM: 0,
    energyKj: 0,
  });
  expect(progress?.facts.slice(100).every((fact) => hasPausedContributions(fact))).toBe(true);
  expect(progress?.quality).toMatchObject({ paused: true, clockSkipped: false });
  expect(progress?.quality?.dataAgeS).toBeCloseTo(5.05, 10);
});
