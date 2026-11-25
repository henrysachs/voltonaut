import { expect, expectTypeOf, it } from "vitest";

import { ProgressCheckpointBatchSchema, type ProgressCheckpointBatch } from "./progress.js";
import {
  RideProgressCheckpointSchema,
  type NativeTickFacts,
  type RideProgressCheckpoint,
  type RideProgressMetadata,
} from "../rideProgress.js";

const journalId = "550e8400-e29b-41d4-a716-446655440000";
const uppercaseJournalId = journalId.toUpperCase();
const otherJournalId = "550e8400-e29b-41d4-a716-446655440001";

const metadata: RideProgressMetadata = {
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

function fact(index: number): NativeTickFacts {
  return {
    powerW: 200,
    cadenceRpm: 90,
    timeS: 0.05,
    distanceM: index + 1,
    elevationGainM: index + 2,
    energyKj: (index + 3) / 100,
  };
}

function checkpoint(
  sequence = 0,
  startTick = 0,
  factCount = 1,
  startedAtMs = 0,
): RideProgressCheckpoint {
  return {
    schemaVersion: 1,
    ...metadata,
    sequence,
    startTick,
    endTick: startTick + factCount,
    startedAtMs,
    endedAtMs: startedAtMs + factCount * 50,
    facts: Array.from({ length: factCount }, (_, index) => fact(startTick + index)),
    quality,
  };
}

function batch(checkpoints: readonly RideProgressCheckpoint[]): ProgressCheckpointBatch {
  return { consentVersion: 1, sessionGeneration: 1, checkpoints };
}

function contiguousCheckpoints(factCounts: readonly number[]): RideProgressCheckpoint[] {
  let sequence = 0;
  let startTick = 0;
  let startedAtMs = 0;

  return factCounts.map((factCount) => {
    const entry = checkpoint(sequence, startTick, factCount, startedAtMs);
    sequence += 1;
    startTick = entry.endTick;
    startedAtMs = entry.endedAtMs;

    return entry;
  });
}

function contiguousPair(): readonly [RideProgressCheckpoint, RideProgressCheckpoint] {
  const first = checkpoint();
  const second = checkpoint(1, first.endTick, 1, first.endedAtMs);

  return [first, second];
}

it("normalizes checkpoint journal UUIDs to lowercase", () => {
  const parsedCheckpoint = RideProgressCheckpointSchema.parse({
    ...checkpoint(),
    journalId: uppercaseJournalId,
  });

  expect(parsedCheckpoint.journalId).toBe(journalId);

  const [first, second] = contiguousPair();

  const parsedBatch = ProgressCheckpointBatchSchema.parse(
    batch([{ ...first, journalId: uppercaseJournalId }, second]),
  );

  expect(parsedBatch.checkpoints.map((entry) => entry.journalId)).toEqual([journalId, journalId]);
});

it("enforces checkpoint count, consent version and readonly batch bounds", () => {
  const parsed = ProgressCheckpointBatchSchema.parse(batch(contiguousCheckpoints([1])));

  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.checkpoints)).toBe(true);
  expectTypeOf<ProgressCheckpointBatch["checkpoints"]>().toEqualTypeOf<
    readonly RideProgressCheckpoint[]
  >();

  expect(ProgressCheckpointBatchSchema.safeParse(batch([])).success).toBe(false);
  expect(
    ProgressCheckpointBatchSchema.safeParse(
      batch(contiguousCheckpoints(Array.from({ length: 1200 }, () => 1))),
    ).success,
  ).toBe(true);
  expect(
    ProgressCheckpointBatchSchema.safeParse(
      batch(contiguousCheckpoints(Array.from({ length: 1201 }, () => 1))),
    ).success,
  ).toBe(false);

  for (const consentVersion of [
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(
      ProgressCheckpointBatchSchema.safeParse({ ...batch([checkpoint()]), consentVersion }).success,
    ).toBe(false);
  }
});

it("accepts contiguous sequences, ticks and nondecreasing checkpoint times", () => {
  const [first, second] = contiguousPair();

  expect(ProgressCheckpointBatchSchema.safeParse(batch([first, second])).success).toBe(true);

  const later = checkpoint(1, first.endTick, 1, first.endedAtMs + 1);

  expect(ProgressCheckpointBatchSchema.safeParse(batch([first, later])).success).toBe(true);
});

it("rejects fractional and unsafe checkpoint timestamps", () => {
  const valid = checkpoint();

  const invalid = [
    { ...valid, startedAtMs: 0.5 },
    { ...valid, endedAtMs: 50.5 },
    {
      ...valid,
      startedAtMs: Number.MAX_SAFE_INTEGER + 1,
      endedAtMs: Number.MAX_SAFE_INTEGER + 1,
    },
  ];

  for (const candidate of invalid) {
    expect(RideProgressCheckpointSchema.safeParse(candidate).success).toBe(false);
  }
});

it("rejects sequence gaps, tick gaps, overlaps and reversed checkpoint times", () => {
  const [first, second] = contiguousPair();

  for (const sequence of [first.sequence, first.sequence + 2]) {
    expect(
      ProgressCheckpointBatchSchema.safeParse(batch([first, { ...second, sequence }])).success,
    ).toBe(false);
  }

  for (const startTick of [first.endTick - 1, first.endTick + 1]) {
    const shifted = checkpoint(1, startTick, 1, first.endedAtMs);

    expect(ProgressCheckpointBatchSchema.safeParse(batch([first, shifted])).success).toBe(false);
  }

  const tooEarly = checkpoint(1, first.endTick, 1, first.endedAtMs - 1);

  expect(ProgressCheckpointBatchSchema.safeParse(batch([first, tooEarly])).success).toBe(false);
});

it("rejects checkpoints from different journals", () => {
  const [first, second] = contiguousPair();

  expect(
    ProgressCheckpointBatchSchema.safeParse(
      batch([first, { ...second, journalId: otherJournalId }]),
    ).success,
  ).toBe(false);
});

it("rejects every immutable metadata change within a batch", () => {
  const changes: readonly ((entry: RideProgressCheckpoint) => RideProgressCheckpoint)[] = [
    (entry) => ({ ...entry, source: "sim" }),
    (entry) => ({ ...entry, clockScale: 19 }),
    (entry) => ({ ...entry, physicsRevision: "engine-v2" }),
    (entry) => ({ ...entry, routeId: "other-loop" }),
    (entry) => ({ ...entry, routeRevision: "2" }),
    (entry) => ({ ...entry, physics: { ...entry.physics, massKg: 80 } }),
    (entry) => ({ ...entry, physics: { ...entry.physics, bikeMassKg: 9 } }),
    (entry) => ({ ...entry, physics: { ...entry.physics, cdaM2: 0.33 } }),
    (entry) => ({ ...entry, physics: { ...entry.physics, crr: 0.005 } }),
    (entry) => ({ ...entry, physics: { ...entry.physics, wheelCircM: 2.2 } }),
  ];

  for (const change of changes) {
    const [first, second] = contiguousPair();

    expect(ProgressCheckpointBatchSchema.safeParse(batch([first, change(second)])).success).toBe(
      false,
    );
  }
});

it("accepts exactly 1200 facts and rejects a larger total", () => {
  const exact = ProgressCheckpointBatchSchema.parse(
    batch(contiguousCheckpoints(Array.from({ length: 10 }, () => 120))),
  );

  expect(exact.checkpoints.reduce((total, entry) => total + entry.facts.length, 0)).toBe(1200);

  const result = ProgressCheckpointBatchSchema.safeParse(
    batch(contiguousCheckpoints(Array.from({ length: 11 }, () => 120))),
  );

  expect(result.success).toBe(false);
  expect(result).toHaveProperty(
    "error.issues",
    expect.arrayContaining([
      expect.objectContaining({ message: "Progress batch must contain at most 1200 facts" }),
    ]),
  );
});

it("strictly rejects unknown batch and checkpoint fields", () => {
  const valid = batch([checkpoint()]);

  expect(ProgressCheckpointBatchSchema.safeParse({ ...valid, accountId: journalId }).success).toBe(
    false,
  );
  expect(
    ProgressCheckpointBatchSchema.safeParse({
      ...valid,
      checkpoints: [{ ...checkpoint(), hrBpm: 140 }],
    }).success,
  ).toBe(false);
});
