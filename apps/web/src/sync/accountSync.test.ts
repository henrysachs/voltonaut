import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE, type ProfileState, type RideReceipt } from "@voltonaut/shared";
import { newOutboxRow, outboxKey, type OutboxRow } from "./accountOutbox.js";
import { PrivateRequestError } from "./privateAuthTransport.js";
import { deferred } from "./testdata/deferred.js";
import { localRide } from "./testdata/localRide.js";
import { journalRide } from "./testdata/journal.js";
import { A, B, fixture } from "./testdata/accountSyncFixture.js";

it("does not claim the guest archive on login; explicit claim snapshots the ride", async () => {
  const f = fixture();
  f.login(A);
  await f.sync.refresh();
  expect(f.rows.size).toBe(0);
  expect(f.uploads).toEqual([]);
  await f.sync.claim(localRide.rideId);
  await expect.poll(() => f.uploads).toEqual([A]);
  await expect.poll(() => [...f.rows.values()][0]?.state.kind).toBe("stored");
  expect([...f.rows.values()][0]?.payload).toEqual(localRide);
});

it("claims raw journal payload only after explicit action, never a local-only track", async () => {
  const f = fixture();
  f.archive = [
    { kind: "journal", recording: journalRide },
    { kind: "local_only", reason: "journal_age", track: localRide },
  ];
  f.login(A);
  await f.sync.refresh();
  expect(f.rows.size).toBe(0);
  await f.sync.claim(localRide.rideId);
  expect(f.rows.size).toBe(0);
  await f.sync.claim(journalRide.rideId);
  expect([...f.rows.values()][0]?.payload).toEqual(journalRide);
  expect(f.sync.view()).toMatchObject({
    kind: "account",
    local: [{ kind: "journal" }, { kind: "local_only" }],
  });
});

it("keeps A's queued payload after logout and never sends it as B", async () => {
  const f = fixture();
  f.login(A);
  await f.sync.refresh();
  f.failure = new PrivateRequestError("retry");
  await f.sync.claim(localRide.rideId);
  await expect.poll(() => f.uploads).toEqual([A]);
  f.logout();
  expect(f.sync.view().kind).toBe("guest");
  f.login(B);
  await f.sync.refresh();
  f.nowMs += 120_000;
  await f.sync.retry();
  expect(f.uploads).toEqual([A]);
  expect([...f.rows.values()][0]?.userId).toBe(A);
});

it("ignores a late A receipt and never paints it into B", async () => {
  const f = fixture();
  const receipt = deferred<RideReceipt>();
  f.nextReceipt = () => receipt.promise;
  f.login(A);
  await f.sync.refresh();
  const sending = f.sync.claim(localRide.rideId);
  await expect.poll(() => f.uploads.length).toBe(1);
  f.logout();
  f.login(B);
  await f.sync.refresh();
  receipt.resolve({
    rideId: localRide.rideId,
    storage: "stored",
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  });
  await sending;
  expect(f.sync.view()).toMatchObject({
    kind: "account",
    user: { id: B },
    outbox: { kind: "ready", value: [] },
  });
  expect([...f.rows.values()][0]?.state.kind).toBe("sending");
});

it("preserves pending local profile while refreshing a different remote profile", async () => {
  const f = fixture();
  const lease = f.login(A);
  await f.sync.refresh();
  const row = newOutboxRow(lease, { ...DEFAULT_RIDER_PROFILE, displayName: "Offline" }, 1000);
  f.rows.set(JSON.stringify(outboxKey(row)), row);
  f.profile = {
    status: "present",
    profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Remote" },
    updatedAt: "2026-11-20T00:00:00.000Z",
  };
  await f.sync.refresh();
  expect([...f.rows.values()][0]?.payload).toMatchObject({ displayName: "Offline" });
  await f.sync.applyProfile();
  expect(f.applied).toEqual([]);
});

it("backs off retryable failures; refresh does not create an upload loop", async () => {
  const f = fixture();
  f.login(A);
  await f.sync.refresh();
  f.failure = new PrivateRequestError("retry");
  await f.sync.claim(localRide.rideId);
  await expect.poll(() => f.uploads).toEqual([A]);
  await f.sync.retry();
  await f.sync.refresh();
  await f.sync.retry();
  expect(f.uploads).toEqual([A]);
  f.nowMs += 120_000;
  await f.sync.retry();
  await expect.poll(() => f.uploads).toEqual([A, A]);
});

it("does not paint an old A profile response into B after the HTTP request completes", async () => {
  const f = fixture();
  const response = deferred<ProfileState>();
  f.profilePending = response.promise;
  f.login(A);
  const loading = f.sync.refresh();
  f.logout();
  f.profilePending = undefined;
  f.login(B);
  await f.sync.refresh();
  response.resolve({
    status: "present",
    profile: { ...DEFAULT_RIDER_PROFILE, displayName: "Private A" },
    updatedAt: "2026-11-20T00:00:00.000Z",
  });
  await loading;
  expect(f.sync.view()).toMatchObject({
    kind: "account",
    user: { id: B },
    profile: { kind: "ready", value: { status: "missing" } },
  });
  expect(JSON.stringify(f.sync.view())).not.toContain("Private A");
});

it("resumes a crashed sending snapshot only with the same validated account", async () => {
  const f = fixture();

  const row = {
    ...newOutboxRow({ userId: A, apiOrigin: "http://localhost:3000" }, localRide, 1000),
    state: { kind: "sending", attempts: 1, retryAtMs: 0 },
  } satisfies OutboxRow;

  await f.write(row);
  f.login(B);
  await f.sync.refresh();
  expect(f.uploads).toEqual([]);
  f.logout();
  f.login(A);
  await expect.poll(() => [...f.rows.values()][0]?.state.kind).toBe("stored");
  expect(f.uploads).toEqual([A]);
  expect([...f.rows.values()][0]).toMatchObject({
    userId: A,
    payload: localRide,
    state: { attempts: 2 },
  });
});

it("retries an old 401 profile after reauthentication even when an older ride is already stored", async () => {
  const f = fixture();
  f.login(A);
  await f.sync.refresh();
  await f.sync.claim(localRide.rideId);
  await expect.poll(() => [...f.rows.values()][0]?.state.kind).toBe("stored");
  f.logout();

  const row = {
    ...newOutboxRow({ userId: A, apiOrigin: "http://localhost:3000" }, DEFAULT_RIDER_PROFILE, 1000),
    state: { kind: "blocked", cause: "reauth", attempts: 1, retryAtMs: 0 },
  } satisfies OutboxRow;

  await f.write(row);
  f.login(A);
  await expect.poll(() => f.rows.get(JSON.stringify(outboxKey(row)))?.state.kind).toBe("stored");
});
