import { afterEach, expect, it, vi } from "vitest";
import { StravaFixture, channelId } from "./stravaFixture.spec.js";
import { StravaConsentSchema } from "@voltonaut/shared";
import type { StravaView } from "./stravaSync.js";

function account(view: StravaView) {
  if (view.kind !== "account") throw new Error("missing test account");

  return view;
}

afterEach(() => {
  vi.useRealTimers();
});

it("opens the fixed bridge synchronously and ignores duplicate and foreign channel messages", async () => {
  const f = new StravaFixture();
  await f.session.exchange("a");
  f.sync.connect();
  expect(f.opens).toEqual([`/strava/bridge?channel=${channelId}`]);
  expect(f.starts).toEqual([]);
  f.message("ready", "00000000-0000-4000-8000-000000000099");
  expect(f.starts).toEqual([]);
  f.message("ready");
  f.message("ready");
  await vi.waitFor(() => {
    expect(f.starts).toEqual(["a"]);
  });
  f.message("finish");
  f.message("finish");
  await vi.waitFor(() => {
    expect(f.confirmations).toEqual(["a"]);
  });
});

it("discards A's late return after a real session generation change to B", async () => {
  const f = new StravaFixture();
  await f.session.exchange("a");
  f.sync.connect();
  f.message("ready");
  await vi.waitFor(() => {
    expect(f.starts).toEqual(["a"]);
  });
  await f.session.exchange("b");
  f.message("finish");
  expect(f.confirmations).toEqual([]);
  expect(f.sync.view()).toMatchObject({ kind: "account", userId: "b" });
  expect(JSON.stringify(f.sync.view())).not.toContain('"42"');
});

it("never exposes late A status to B even when a transport ignores abort", async () => {
  const f = new StravaFixture();
  f.hold();
  await f.session.exchange("a");
  await f.session.logout();
  await f.session.exchange("b");
  f.pending.resolve({
    status: "connected",
    athleteId: "42",
    scope: "activity:write",
    accessExpiresAt: "2027-01-01T00:00:00.000Z",
  });
  await Promise.resolve();
  expect(f.sync.view()).toMatchObject({ kind: "account", userId: "b" });
  expect(JSON.stringify(f.sync.view())).not.toContain('"42"');
});

it("fails visibly without BroadcastChannel and never starts authorization", async () => {
  const f = new StravaFixture();
  await f.session.exchange("a");
  f.absent();
  f.sync.connect();
  expect(f.starts).toEqual([]);
  expect(f.opens).toEqual([]);
  expect(f.sync.view()).toMatchObject({
    busy: false,
  });
  expect(JSON.stringify(f.sync.view())).toContain("gesperrt");
});

it("ends a blocked popup at the readiness deadline without top-level navigation", async () => {
  vi.useFakeTimers();
  const f = new StravaFixture();
  await f.session.exchange("a");
  f.sync.connect();
  await vi.advanceTimersByTimeAsync(5001);
  expect(f.starts).toEqual([]);
  expect(f.sync.view()).toMatchObject({
    busy: false,
  });
  expect(JSON.stringify(f.sync.view())).toContain("Popup blockiert");
});

it("does not send an obsolete A consent with B's current private lease", async () => {
  const f = new StravaFixture();
  await f.session.exchange("a");

  const consent = StravaConsentSchema.parse({
    rideId: "00000000-0000-4000-8000-000000000001",
    payloadHash: "a".repeat(64),
    exportHash: "b".repeat(64),
    exportVersion: "tcx-1",
    connectionGeneration: "a-generation",
    athleteId: "42",
    sourcePolicy: "declared_ble_v1",
    noticeRevision: "virtual-ride-1",
  });

  await f.session.exchange("b");
  await f.sync.upload(consent);
  expect(f.uploads).toEqual([]);
  expect(f.sync.view()).toMatchObject({ kind: "account", userId: "b", ride: { kind: "none" } });
});

it("invalidates already-rendered actions on account change and on a new generation of the same account", async () => {
  const f = new StravaFixture();
  const calls: string[] = [];
  await f.session.exchange("a");

  expect(account(f.sync.view()).userId).toBe("a");

  const action = f.sync.guard(() => {
    calls.push("action");
  });

  await f.session.exchange("b");
  action();
  await f.session.exchange("a");
  action();
  expect(calls).toEqual([]);
});
