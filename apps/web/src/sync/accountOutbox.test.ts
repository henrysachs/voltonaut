import { expect, it } from "vitest";

import { newOutboxRow, OutboxRowSchema, retryState } from "./accountOutbox.js";
import { localRide } from "./testdata/localRide.js";

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
