import { expect, expectTypeOf, it } from "vitest";

import {
  createRideProgressProjector,
  NativeTickFactsSchema,
  RideProgressCheckpointSchema,
  type NativeTickFacts,
  type RideProgressCheckpoint,
  type RideProgressCheckpointInput,
} from "./rideProgress.js";

const journalId = "550e8400-e29b-41d4-a716-446655440000";
const factKeys = ["powerW", "cadenceRpm", "timeS", "distanceM", "elevationGainM", "energyKj"];

const checkpointKeys = [
  "schemaVersion",
  "journalId",
  "sequence",
  "startTick",
  "endTick",
  "startedAtMs",
  "endedAtMs",
  "source",
  "clockScale",
  "physicsRevision",
  "routeId",
  "routeRevision",
  "physics",
  "facts",
  "quality",
];

const metadata: Omit<
  RideProgressCheckpointInput,
  "startedAtMs" | "endedAtMs" | "facts" | "quality"
> = {
  journalId,
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

function checkpoint(facts: readonly NativeTickFacts[] = [fact()]): RideProgressCheckpoint {
  return {
    schemaVersion: 1,
    ...metadata,
    sequence: 0,
    startTick: 0,
    endTick: facts.length,
    startedAtMs: 0,
    endedAtMs: 50,
    facts,
    quality,
  };
}

function requireCheckpoint(value: RideProgressCheckpoint | undefined): RideProgressCheckpoint {
  if (value === undefined) throw new Error("Expected a progress checkpoint");

  return value;
}

it("defines exactly the readonly HR-free native fact fields", () => {
  const parsed = NativeTickFactsSchema.parse(fact());

  expect(Object.keys(parsed)).toEqual(factKeys);
  expect(Object.isFrozen(parsed)).toBe(true);
  expectTypeOf<keyof NativeTickFacts>().toEqualTypeOf<
    "powerW" | "cadenceRpm" | "timeS" | "distanceM" | "elevationGainM" | "energyKj"
  >();
});

it("accepts signed power, unbounded nonnegative cadence and signed native energy", () => {
  const lower = NativeTickFactsSchema.parse({
    ...fact(),
    powerW: -Number.MAX_VALUE,
    cadenceRpm: 4_026_163_200,
    energyKj: -Number.MAX_VALUE,
  });

  const upper = NativeTickFactsSchema.parse({
    ...fact(),
    powerW: Number.MAX_VALUE,
    cadenceRpm: 0,
    energyKj: Number.MAX_VALUE,
  });

  expect(lower).toMatchObject({ powerW: -Number.MAX_VALUE, cadenceRpm: 4_026_163_200 });
  expect(upper).toMatchObject({ powerW: Number.MAX_VALUE, energyKj: Number.MAX_VALUE });
});

it("rejects negative cadence, time or distance contributions", () => {
  const invalid = [
    { ...fact(), cadenceRpm: -0.01 },
    { ...fact(), timeS: -0.01 },
    { ...fact(), timeS: 0.050_001 },
    { ...fact(), distanceM: -1 },
    { ...fact(), elevationGainM: -1 },
  ];

  for (const candidate of invalid) {
    expect(NativeTickFactsSchema.safeParse(candidate).success).toBe(false);
  }
});

it("rejects non-finite native facts", () => {
  for (const key of factKeys) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(NativeTickFactsSchema.safeParse({ ...fact(), [key]: value }).success).toBe(false);
    }
  }
});

it("strictly rejects HR, RR, account, device and unknown fact fields", () => {
  for (const extra of [
    { hrBpm: 140 },
    { bpm: 140 },
    { rrMs: [800] },
    { accountId: journalId },
    { deviceId: "trainer-1" },
    { accepted: true },
  ]) {
    expect(NativeTickFactsSchema.safeParse({ ...fact(), ...extra }).success).toBe(false);
  }
});

it("validates and freezes the complete readonly checkpoint envelope", () => {
  const parsed = RideProgressCheckpointSchema.parse(checkpoint());

  expect(Object.keys(parsed)).toHaveLength(checkpointKeys.length);

  for (const key of checkpointKeys) expect(parsed).toHaveProperty(key);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.facts)).toBe(true);
  expect(Object.isFrozen(parsed.facts[0])).toBe(true);
  expect(Object.isFrozen(parsed.physics)).toBe(true);
  expect(Object.isFrozen(parsed.quality)).toBe(true);
  expectTypeOf<RideProgressCheckpoint["facts"]>().toEqualTypeOf<readonly NativeTickFacts[]>();
  expectTypeOf<RideProgressCheckpoint["schemaVersion"]>().toEqualTypeOf<1>();
  expectTypeOf<Pick<RideProgressCheckpoint, "sequence">>().toEqualTypeOf<{
    readonly sequence: number;
  }>();
  expectTypeOf<RideProgressCheckpoint["quality"]>().toEqualTypeOf<{
    readonly paused: boolean;
    readonly dataAgeS: number;
    readonly clockSkipped: boolean;
  }>();
});

it("rejects inconsistent checkpoint tick and time ranges", () => {
  const valid = checkpoint();

  const invalid = [
    { ...valid, journalId: "not-a-uuid" },
    { ...valid, sequence: -1 },
    { ...valid, sequence: 0.5 },
    { ...valid, startTick: -1 },
    { ...valid, endTick: 2 },
    { ...valid, startedAtMs: -1 },
    { ...valid, endedAtMs: Number.NaN },
    { ...valid, startedAtMs: 51, endedAtMs: 50 },
  ];

  for (const candidate of invalid) {
    expect(RideProgressCheckpointSchema.safeParse(candidate).success).toBe(false);
  }
});

it("rejects invalid checkpoint metadata, physics, quality and fact counts", () => {
  const valid = checkpoint();

  const invalid = [
    { ...valid, schemaVersion: 2 },
    { ...valid, source: "manual" },
    { ...valid, clockScale: 0.99 },
    { ...valid, clockScale: 20.01 },
    { ...valid, physicsRevision: "" },
    { ...valid, routeId: "" },
    { ...valid, routeRevision: "" },
    { ...valid, physics: { ...valid.physics, massKg: -1 } },
    { ...valid, physics: { ...valid.physics, crr: -1 } },
    { ...valid, facts: [] },
    { ...valid, facts: Array.from({ length: 121 }, (_, index) => fact(index)), endTick: 121 },
    { ...valid, quality: { ...valid.quality, paused: "no" } },
    { ...valid, quality: { ...valid.quality, dataAgeS: -1 } },
    { ...valid, quality: { ...valid.quality, clockSkipped: 1 } },
  ];

  for (const candidate of invalid) {
    expect(RideProgressCheckpointSchema.safeParse(candidate).success).toBe(false);
  }
});

it("strictly rejects unknown checkpoint fields at every level", () => {
  const valid = checkpoint();

  for (const extra of [{ hrBpm: 140 }, { bpm: 140 }, { accountId: journalId }]) {
    expect(RideProgressCheckpointSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  }

  const invalid = [
    { ...valid, physics: { ...valid.physics, deviceId: "trainer-1" } },
    { ...valid, quality: { ...valid.quality, rrMs: [800] } },
    { ...valid, facts: valid.facts.map((entry) => Object.assign({}, entry, { hrBpm: 140 })) },
  ];

  for (const candidate of invalid) {
    expect(RideProgressCheckpointSchema.safeParse(candidate).success).toBe(false);
  }
});

it("does not advance projector sequence or ticks for an empty batch", () => {
  const projector = createRideProgressProjector();

  expect(projector.push(input([]))).toBeUndefined();
  expect(requireCheckpoint(projector.push(input([fact()])))).toMatchObject({
    sequence: 0,
    startTick: 0,
    endTick: 1,
  });
});

it("covers every native tick exactly once across multiple pushes", () => {
  const projector = createRideProgressProjector();
  const facts = Array.from({ length: 5 }, (_, index) => fact(index));

  const first = requireCheckpoint(
    projector.push({ ...input(facts.slice(0, 2)), startedAtMs: 0, endedAtMs: 50 }),
  );

  const second = requireCheckpoint(
    projector.push({ ...input(facts.slice(2, 3)), startedAtMs: 50, endedAtMs: 100 }),
  );

  const third = requireCheckpoint(
    projector.push({ ...input(facts.slice(3)), startedAtMs: 100, endedAtMs: 150 }),
  );

  expect([first.sequence, second.sequence, third.sequence]).toEqual([0, 1, 2]);
  expect([
    [first.startTick, first.endTick],
    [second.startTick, second.endTick],
    [third.startTick, third.endTick],
  ]).toEqual([
    [0, 2],
    [2, 3],
    [3, 5],
  ]);
  expect([first, second, third].flatMap((entry) => entry.facts)).toEqual(facts);
});

it("accepts 120 facts and keeps counters unchanged after an oversized batch", () => {
  const projector = createRideProgressProjector();
  const facts = Array.from({ length: 120 }, (_, index) => fact(index));

  expect(requireCheckpoint(projector.push(input(facts))).facts).toHaveLength(120);
  expect(() =>
    projector.push(input(Array.from({ length: 121 }, (_, index) => fact(index)))),
  ).toThrow(/at most 120/u);
  expect(requireCheckpoint(projector.push(input([fact(120)])))).toMatchObject({
    sequence: 1,
    startTick: 120,
    endTick: 121,
  });
});
