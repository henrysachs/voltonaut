/* oxlint-disable typescript/prefer-readonly-parameter-types -- Readonly schema rows are passed to Object.entries in the required-metadata test. */
import { expect, it } from "vitest";
import {
  JournalIdSchema,
  VoltsRideRangeReceiptSchema,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";

import { LocalProgressBatchSchema as LocalBatchSchema } from "./progressBatch.js";
import { progressFailureState, progressOutboxKey } from "./progressOutboxDatabase.js";
import {
  ProgressOutboxRowSchema,
  newProgressOutboxRow,
  progressPayloadHash,
  progressReceiptCoversRow,
  type ProgressJournalOwner,
} from "./progressOutbox.js";

const owner: ProgressJournalOwner = {
  apiOrigin: "http://localhost:3000",
  userId: "00000000-0000-4000-8000-000000000001",
  journalId: JournalIdSchema.parse("550e8400-e29b-41d4-a716-446655440000"),
};

function checkpoint(paused = false): RideProgressCheckpoint {
  return {
    schemaVersion: 1,
    journalId: owner.journalId,
    sequence: 0,
    startTick: 0,
    endTick: 1,
    startedAtMs: 1000,
    endedAtMs: 1050,
    source: "ble",
    clockScale: 1,
    physicsRevision: "engine-v1",
    worldId: "flat-loop",
    worldRevision: "1",
    pathId: "flat-loop",
    physics: {
      massKg: 75,
      bikeMassKg: 8,
      cdaM2: 0.32,
      crr: 0.004,
      wheelCircM: 2.105,
    },
    facts: [
      {
        powerW: 200,
        cadenceRpm: 90,
        timeS: 0.05,
        distanceM: 1,
        elevationGainM: 0,
        energyKj: 0.01,
      },
    ],
    quality: { paused, dataAgeS: 0, clockSkipped: false },
  };
}

function row(paused = false) {
  const batch = LocalBatchSchema.parse({
    consentVersion: 1,
    sessionGeneration: 1,
    checkpoints: [checkpoint(paused)],
  });

  return newProgressOutboxRow({
    owner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch,
    phase: paused ? "sealed" : "open",
  });
}

function receipt(startTick = 0, endTick = 1) {
  return VoltsRideRangeReceiptSchema.parse({
    entryId: "123e4567-e89b-42d3-a456-426614174001",
    journalId: owner.journalId,
    startTick,
    endTick,
    rewardDay: "2026-11-25",
    cumulativeWorkVolts: 1,
    cumulativeClimbVolts: 0,
    candidateVolts: 1,
    awardedVolts: 1,
    withheldVolts: 0,
  });
}

it("uses the exact composite owner key and a stable immutable payload fingerprint", () => {
  const stored = row();

  expect(progressOutboxKey(stored)).toEqual([owner.apiOrigin, owner.userId, owner.journalId, 0]);
  expect(stored.sequenceKeys).toEqual([[owner.apiOrigin, owner.userId, owner.journalId, 0]]);
  expect(Object.isFrozen(stored.sequenceKeys)).toBe(true);
  expect(Object.isFrozen(stored.sequenceKeys[0])).toBe(true);
  expect(progressPayloadHash(stored.payload)).toBe(stored.hash);
  expect(progressPayloadHash(stored.payload)).toBe(stored.hash);
  expect(stored.hash).toMatch(/^[0-9a-f]{16}$/u);

  const reordered = LocalBatchSchema.parse({
    checkpoints: stored.payload.checkpoints,
    sessionGeneration: stored.payload.sessionGeneration,
    consentVersion: stored.payload.consentVersion,
  });

  expect(progressPayloadHash(reordered)).toBe(stored.hash);
  expect(Object.isFrozen(stored)).toBe(true);
  expect(Object.isFrozen(stored.payload)).toBe(true);
  expect(Object.isFrozen(stored.payload.checkpoints[0]?.facts[0])).toBe(true);

  const changed = LocalBatchSchema.parse({
    ...stored.payload,
    checkpoints: [
      {
        ...stored.payload.checkpoints[0],
        facts: [{ ...stored.payload.checkpoints[0]?.facts[0], powerW: 201 }],
      },
    ],
  });

  expect(progressPayloadHash(changed)).not.toBe(stored.hash);
  expect(stored.payload.checkpoints[0]?.facts[0]?.powerW).toBe(200);
});

it("rejects corrupted hashes, ownership, token fields and receipt ranges while allowing paused open rows", () => {
  const stored = row();

  expect(ProgressOutboxRowSchema.safeParse({ ...stored, sessionToken: "secret" }).success).toBe(
    false,
  );
  expect(ProgressOutboxRowSchema.safeParse({ ...stored, hash: "0".repeat(16) }).success).toBe(
    false,
  );
  expect(
    ProgressOutboxRowSchema.safeParse({
      ...stored,
      payload: { ...stored.payload, consentVersion: 2 },
    }).success,
  ).toBe(false);
  expect(
    ProgressOutboxRowSchema.safeParse({ ...stored, apiOrigin: `${owner.apiOrigin}/exfil` }).success,
  ).toBe(false);
  expect(ProgressOutboxRowSchema.safeParse(row(true)).success).toBe(true);
  expect(
    ProgressOutboxRowSchema.safeParse({
      ...row(true),
      phase: "open",
    }).success,
  ).toBe(true);
  expect(
    ProgressOutboxRowSchema.safeParse({
      ...row(true),
      state: { kind: "stored", attempts: 1, retryAtMs: 0, receipt: receipt(1, 2) },
    }).success,
  ).toBe(false);
});

it("accepts a server receipt that covers a local batch inside a grouped range", () => {
  const stored = row(true);
  const covering = receipt(0, 10);

  expect(progressReceiptCoversRow(covering, stored)).toBe(true);
  expect(progressReceiptCoversRow(receipt(1, 10), stored)).toBe(false);
  expect(
    ProgressOutboxRowSchema.safeParse({
      ...stored,
      state: { kind: "stored", attempts: 1, retryAtMs: 0, receipt: covering },
    }).success,
  ).toBe(true);
});

it("keeps exponential backoff finite and blocks only after five automatic attempts", () => {
  expect(progressFailureState(1, "retry", 1000)).toEqual({
    kind: "queued",
    attempts: 1,
    retryAtMs: 2000,
  });
  expect(progressFailureState(4, "retry", 1000)).toEqual({
    kind: "queued",
    attempts: 4,
    retryAtMs: 9000,
  });
  expect(progressFailureState(5, "retry", 1000)).toEqual({
    kind: "blocked",
    cause: "retry",
    attempts: 5,
    retryAtMs: 17_000,
  });
  expect(progressFailureState(1, "forbidden", 1000)).toMatchObject({
    kind: "blocked",
    cause: "forbidden",
    attempts: 1,
  });
  expect(progressFailureState(20, "retry", 1000).retryAtMs).toBe(61_000);
});

it("allows paused open rows and requires persisted metadata and composite sequence keys", () => {
  const value = LocalBatchSchema.parse({
    consentVersion: 1,
    sessionGeneration: 1,
    checkpoints: [checkpoint(true)],
  });

  const open = newProgressOutboxRow({
    owner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch: value,
    phase: "open",
  });

  expect(ProgressOutboxRowSchema.safeParse(open).success).toBe(true);
  expect(open.sequenceKeys).toEqual([[owner.apiOrigin, owner.userId, owner.journalId, 0]]);

  const metadata = new Set([
    "startTick",
    "endTick",
    "startSequence",
    "endSequence",
    "sequences",
    "sequenceKeys",
    "factCount",
    "timeS",
  ]);

  for (const field of metadata) {
    const incomplete = Object.fromEntries(Object.entries(open).filter(([key]) => key !== field));

    expect(ProgressOutboxRowSchema.safeParse(incomplete).success).toBe(false);
  }

  expect(
    ProgressOutboxRowSchema.safeParse({
      ...open,
      sequenceKeys: [[owner.apiOrigin, owner.userId, owner.journalId, 1]],
    }).success,
  ).toBe(false);
  expect(
    ProgressOutboxRowSchema.safeParse({
      ...open,
      sequenceKeys: [["http://localhost:4000", owner.userId, owner.journalId, 0]],
    }).success,
  ).toBe(false);
  expect(ProgressOutboxRowSchema.parse(open)).toEqual(open);
});

it("normalizes journal UUID aliases without mutating the caller's checkpoint", () => {
  const uppercase = { ...checkpoint(), journalId: owner.journalId.toUpperCase() };

  const batch = LocalBatchSchema.parse({
    consentVersion: 1,
    sessionGeneration: 1,
    checkpoints: [uppercase],
  });

  const stored = newProgressOutboxRow({
    owner,
    consentVersion: 1,
    sessionGeneration: 1,
    batch,
    phase: "sealed",
  });

  expect(stored.payload.checkpoints[0]?.journalId).toBe(owner.journalId);
  expect(uppercase.journalId).toBe(owner.journalId.toUpperCase());
});
