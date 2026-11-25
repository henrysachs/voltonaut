import { expect, it } from "vitest";

import {
  RideProgressCheckpointSchema,
  type DeviceEvent,
  type NativeTickFacts,
} from "@voltonaut/shared";

import { createRideHarness } from "./testdata/recordedRideHarness.js";

function batchRide(clockScale: number) {
  return createRideHarness({ init: { routeId: "flat-loop", clockScale } });
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
    const run = batchRide(1);

    run.arm();
    expect(run.capture("start")).toMatchObject({ kind: "state", view: { kind: "recording" } });

    const reading = {
      type: "trainer.data",
      tS: 0,
      powerW,
      cadenceRpm,
    } satisfies DeviceEvent;

    run.ingest(reading);
    const update = run.wake(50);

    expect(update.progress?.facts[0]).toMatchObject({ powerW, cadenceRpm, energyKj });
    expect(RideProgressCheckpointSchema.safeParse(update.progress).success).toBe(true);
    expect(update.recording).toMatchObject({
      kind: "recording",
      availability: { kind: "local_only", reason: "invalid_input" },
    });
    expect(run.updates).toHaveLength(2);
  },
);

it("keeps the single freshness transition and terminal data age inside one batch", () => {
  const run = batchRide(20);

  run.ingest({ type: "trainer.data", tS: 0, powerW: 300, cadenceRpm: 80 });
  run.arm();
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
  const run = batchRide(20);

  run.arm();
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
