import { expect, it } from "vitest";

import { newOutboxRow, OutboxRowSchema, retryState } from "./accountOutbox.js";
import { localRide } from "./testdata/localRide.js";
import { journalRide } from "./testdata/journal.js";

const owner = {
  userId: "00000000-0000-4000-8000-000000000001",
  apiOrigin: "http://localhost:3000",
};

it("canonicalizes immutable upload IDs without rewriting the legacy archive", () => {
  const uppercase = { ...localRide, rideId: localRide.rideId.toUpperCase() };
  const row = newOutboxRow(owner, uppercase, 1000);
  expect(row).toMatchObject({ kind: "ride", payload: { rideId: localRide.rideId } });
  expect(uppercase.rideId).toBe(localRide.rideId.toUpperCase());
});

it("rejects corrupted persisted state, receipts, token fields and non-origin URLs", () => {
  const row = newOutboxRow(owner, localRide, 1000);
  expect(OutboxRowSchema.safeParse({ ...row, sessionToken: "not allowed" }).success).toBe(false);
  expect(
    OutboxRowSchema.safeParse({
      ...row,
      state: { kind: "blocked", cause: "arbitrary", attempts: 1, retryAtMs: 0 },
    }).success,
  ).toBe(false);
  expect(OutboxRowSchema.safeParse({ ...row, apiOrigin: `${owner.apiOrigin}/exfil` }).success).toBe(
    false,
  );
  expect(
    OutboxRowSchema.safeParse({
      ...row,
      state: {
        kind: "stored",
        attempts: 1,
        retryAtMs: 0,
        receipt: {
          rideId: "00000000-0000-4000-8000-000000000002",
          storage: "stored",
          assessment: { status: "unverified", reason: "legacy_missing_replay" },
        },
      },
    }).success,
  ).toBe(false);
});

it("uses finite backoff and stops after five attempts or an actionable permanent error", () => {
  expect(retryState(1, "retry", 1000)).toEqual({ kind: "queued", attempts: 1, retryAtMs: 3000 });
  expect(retryState(5, "retry", 1000)).toMatchObject({
    kind: "blocked",
    cause: "retry",
    attempts: 5,
  });
  expect(retryState(1, "conflict", 1000)).toMatchObject({ kind: "blocked", cause: "conflict" });
});

it("keeps raw journal snapshots and replay receipts on the same persisted path", () => {
  const row = newOutboxRow(owner, journalRide, 1000);

  const stored = OutboxRowSchema.parse({
    ...row,
    state: {
      kind: "stored",
      attempts: 1,
      retryAtMs: 0,
      receipt: {
        rideId: journalRide.rideId,
        storage: "stored",
        assessment: {
          status: "replayed",
          physicsRevision: "engine-v1",
          summary: {
            elapsedRealS: 1,
            distanceM: 1,
            elevationGainM: 0,
            energyKj: 0.25,
            tS: 1,
            laps: 0,
            eventCount: 20,
            commandCount: 4,
          },
          source: {
            assurance: "client_declared",
            declaredSource: "ble",
            window: { kind: "continuous" },
          },
        },
      },
    },
  });

  expect(OutboxRowSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  expect(stored.payload).toEqual(journalRide);
  expect(
    OutboxRowSchema.safeParse({ ...row, payload: { kind: "journal", recording: journalRide } })
      .success,
  ).toBe(false);
});

it("retains an original historical unverified receipt without promoting it", () => {
  const row = newOutboxRow(owner, localRide, 1000);

  const stored = OutboxRowSchema.parse({
    ...row,
    state: {
      kind: "stored",
      attempts: 1,
      retryAtMs: 0,
      receipt: {
        rideId: localRide.rideId,
        storage: "stored",
        assessment: { status: "unverified", reason: "legacy_missing_replay" },
      },
    },
  });

  const json = JSON.stringify(stored);
  expect(JSON.stringify(OutboxRowSchema.parse(JSON.parse(json)))).toBe(json);
});
