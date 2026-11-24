import { expect, it } from "vitest";

import {
  createRideProgressProjector,
  type NativeTickFacts,
  type RideProgressCheckpoint,
  type RideProgressCheckpointInput,
} from "./rideProgress.js";

const metadata: Omit<
  RideProgressCheckpointInput,
  "startedAtMs" | "endedAtMs" | "facts" | "quality"
> = {
  journalId: "550e8400-e29b-41d4-a716-446655440000",
  source: "ble",
  clockScale: 20,
  physicsRevision: "engine-v1",
  routeId: "test-loop",
  routeRevision: "1",
  physics: {
    massKg: 75,
    bikeMassKg: 8,
    cdaM2: 0.32,
    crr: 0.004,
    wheelCircM: 2.105,
  },
};

const quality = {
  paused: false,
  dataAgeS: 0,
  clockSkipped: false,
} satisfies RideProgressCheckpoint["quality"];

function fact(index = 0): NativeTickFacts {
  return {
    powerW: 200,
    cadenceRpm: 90,
    timeS: 0.05,
    distanceM: index + 1,
    elevationGainM: index + 2,
    energyKj: (index + 3) / 100,
  };
}

function input(facts: readonly NativeTickFacts[]): RideProgressCheckpointInput {
  return { ...metadata, startedAtMs: 0, endedAtMs: 50, facts, quality };
}

function requireCheckpoint(value: RideProgressCheckpoint | undefined): RideProgressCheckpoint {
  if (value === undefined) throw new Error("Expected a progress checkpoint");

  return value;
}

function requireFact(value: NativeTickFacts | undefined): NativeTickFacts {
  if (value === undefined) throw new Error("Expected one projected fact");

  return value;
}

it("produces identical checkpoints for identical batch inputs", () => {
  const left = createRideProgressProjector();
  const right = createRideProgressProjector();

  const batches = [
    input([fact(0), fact(1)]),
    { ...input([fact(2)]), startedAtMs: 50, endedAtMs: 100 },
    { ...input([fact(3)]), startedAtMs: 100, endedAtMs: 150 },
  ];

  for (const batch of batches) {
    expect(left.push(batch)).toEqual(right.push(batch));
  }
});

it("preserves equal native fact bytes across batched and incremental boundaries", () => {
  const facts = Array.from({ length: 5 }, (_, index) => fact(index));
  const batched = createRideProgressProjector();
  const incremental = createRideProgressProjector();
  const batchCheckpoint = requireCheckpoint(batched.push(input(facts)));

  const incrementalCheckpoints = facts.map((entry, index) =>
    requireCheckpoint(
      incremental.push({
        ...input([entry]),
        startedAtMs: index * 50,
        endedAtMs: (index + 1) * 50,
      }),
    ),
  );

  expect(JSON.stringify(batchCheckpoint.facts)).toBe(
    JSON.stringify(incrementalCheckpoints.flatMap((entry) => entry.facts)),
  );
  expect(batchCheckpoint.endTick).toBe(incrementalCheckpoints.at(-1)?.endTick);
});

it("freezes and copies facts, physics and quality instead of retaining caller objects", () => {
  const projector = createRideProgressProjector();
  const mutableFact = { ...fact() };
  const mutablePhysics = { ...metadata.physics };
  const mutableQuality = { ...quality, paused: true, dataAgeS: 2.5, clockSkipped: true };
  const callerFacts = [mutableFact];

  const projected = requireCheckpoint(
    projector.push({
      ...input(callerFacts),
      endedAtMs: 75,
      physics: mutablePhysics,
      quality: mutableQuality,
    }),
  );

  const copiedFact = requireFact(projected.facts[0]);

  mutableFact.powerW = 999;
  callerFacts.push(fact(1));
  mutablePhysics.massKg = 140;
  mutableQuality.paused = false;

  expect(Object.isFrozen(projected)).toBe(true);
  expect(Object.isFrozen(projected.facts)).toBe(true);
  expect(Object.isFrozen(copiedFact)).toBe(true);
  expect(Object.isFrozen(projected.physics)).toBe(true);
  expect(Object.isFrozen(projected.quality)).toBe(true);
  expect(projected.facts).toEqual([fact()]);
  expect(projected.physics).toEqual(metadata.physics);
  expect(projected.quality).toEqual({ paused: true, dataAgeS: 2.5, clockSkipped: true });
  expect(projected).toMatchObject({ startedAtMs: 0, endedAtMs: 75 });
  expect(() => Object.defineProperty(copiedFact, "powerW", { value: 999 })).toThrow(TypeError);
});

it("rejects unknown input fields without advancing the journal", () => {
  const projector = createRideProgressProjector();
  const invalidInput = { ...input([fact()]), hrBpm: 140 };

  expect(() => projector.push(invalidInput)).toThrow(/hrBpm/u);
  expect(requireCheckpoint(projector.push(input([fact()])))).toMatchObject({
    sequence: 0,
    startTick: 0,
    endTick: 1,
  });
});
