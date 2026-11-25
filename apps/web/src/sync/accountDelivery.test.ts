import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE, type ProfileState } from "@voltonaut/shared";

import { deliverAccountRow, type DeliveryLease } from "./accountDelivery.js";
import { newOutboxRow, type AccountOutbox, type OutboxRow } from "./accountOutbox.js";
import { PrivateRequestError } from "./apiRoute.js";
import { localRide } from "./testdata/localRide.js";

const owner = {
  apiOrigin: "http://localhost:3000",
  userId: "00000000-0000-4000-8000-000000000001",
};

class DeliveryFixture {
  nowMs = 100_000;
  calls = 0;
  failure: PrivateRequestError | undefined;
  row: OutboxRow = newOutboxRow(owner, localRide, 1000);
  readonly lease: DeliveryLease = {
    signal: new AbortController().signal,
    ...owner,
    generation: 1,
    current: () => true,
    profile: { save: () => Promise.resolve(this.profileReceipt) },
    rides: {
      upload: (payload) => {
        this.calls += 1;

        if (this.failure !== undefined) return Promise.reject(this.failure);

        return Promise.resolve({
          rideId: payload.rideId,
          storage: "stored",
          assessment: { status: "unverified", reason: "legacy_missing_replay" },
        });
      },
    },
  };
  profileReceipt: ProfileState = { status: "missing" };
  readonly database: AccountOutbox = {
    list: () => Promise.resolve([this.row]),
    claim: () => Promise.resolve(),
    update: (row) => {
      this.row = row;

      return Promise.resolve();
    },
    purgeOwner: () => Promise.resolve(),
  };
  run(mode: "manual" | "resume" = "resume"): ReturnType<typeof deliverAccountRow> {
    return deliverAccountRow(this.lease, this.database, this.row, () => this.nowMs, mode);
  }

  persistSendingOnly(row: OutboxRow): Promise<void> {
    return row.state.kind === "blocked"
      ? Promise.reject(new Error("quota"))
      : this.database.update(row);
  }
}

it("keeps actionable 401 and 409 errors blocked, not stored", async () => {
  const f = new DeliveryFixture();
  f.failure = new PrivateRequestError("reauth");
  await f.run();
  expect(f.row.state).toMatchObject({ kind: "blocked", cause: "reauth" });
  f.failure = new PrivateRequestError("conflict");
  f.nowMs += 100_000;
  await f.run();
  expect(f.row.state).toMatchObject({ kind: "blocked", cause: "conflict" });
  await f.run("manual");
  expect(f.calls).toBe(2);
});

it("restarts an exhausted retry budget only after explicit action and backoff", async () => {
  const f = new DeliveryFixture();
  f.row = {
    ...f.row,
    state: { kind: "blocked", cause: "retry", attempts: 5, retryAtMs: f.nowMs + 1000 },
  };
  await f.run("manual");
  expect(f.calls).toBe(0);
  f.nowMs += 2000;
  await f.run("resume");
  expect(f.calls).toBe(0);
  await f.run("manual");
  expect(f.calls).toBe(1);
  expect(f.row.state).toMatchObject({ kind: "stored", attempts: 1 });
});

it("does not send without a confirmed durable sending state", async () => {
  const f = new DeliveryFixture();

  const database: AccountOutbox = {
    ...f.database,
    update: () => Promise.reject(new Error("quota")),
  };

  await expect(deliverAccountRow(f.lease, database, f.row, () => f.nowMs)).rejects.toThrow("quota");
  expect(f.calls).toBe(0);
  expect(f.row.state.kind).toBe("queued");
});

it("rejects profile receipt mismatches without replacing the pending snapshot", async () => {
  const f = new DeliveryFixture();
  f.row = newOutboxRow(owner, DEFAULT_RIDER_PROFILE, 1000);
  f.profileReceipt = {
    status: "present",
    profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Unexpected" },
    updatedAt: "2026-11-20T00:00:00.000Z",
  };
  await f.run();
  expect(f.row).toMatchObject({
    kind: "profile",
    payload: DEFAULT_RIDER_PROFILE,
    state: { kind: "blocked", cause: "contract" },
  });
});

it("does not authorize an immutable row with another origin or another account", async () => {
  const f = new DeliveryFixture();
  await deliverAccountRow(
    { ...f.lease, apiOrigin: "http://localhost:4000" },
    f.database,
    f.row,
    () => f.nowMs,
  );
  await deliverAccountRow(
    { ...f.lease, userId: "00000000-0000-4000-8000-000000000002" },
    f.database,
    f.row,
    () => f.nowMs,
  );
  expect(f.calls).toBe(0);
  expect(f.row.state.kind).toBe("queued");
});

it("still requests reauthentication if quota prevents persisting the 401 status", async () => {
  const f = new DeliveryFixture();
  f.failure = new PrivateRequestError("reauth");

  const database: AccountOutbox = {
    ...f.database,
    update: (row) => f.persistSendingOnly(row),
  };

  await expect(deliverAccountRow(f.lease, database, f.row, () => f.nowMs)).resolves.toBe("reauth");
  expect(f.row.state.kind).toBe("sending");
  expect(f.calls).toBe(1);
});
