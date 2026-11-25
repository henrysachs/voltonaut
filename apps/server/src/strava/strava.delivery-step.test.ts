import { expect, expectTypeOf, it } from "vitest";
import { uploadFixture } from "./strava.scheduler-fixture.spec.js";
import type { CommittedAttempt } from "./strava.delivery-store.js";
import type { SubmittingDelivery } from "./strava.delivery-state.js";
import type { StravaProvider } from "./strava.provider.js";

const shutdown = new AbortController().signal;

it("only accepts a store-committed attempt as provider upload input", () => {
  expectTypeOf<{
    readonly delivery: SubmittingDelivery;
    readonly externalId: string;
  }>().not.toExtend<CommittedAttempt>();
  expectTypeOf<
    Parameters<StravaProvider["submit"]>[0]["attempt"]
  >().toEqualTypeOf<CommittedAttempt>();
});

it("releases the upload reservation when another owner stops the ride before the dispatch commit", async () => {
  const { a, b, budget, peer, step, rideId } = await uploadFixture();
  const pending = step.submitNext(shutdown);
  b.jobs.stop("owner", "policy", 20000);
  await pending;
  expect(peer.resources.submitCalls).toBe(0);
  expect(a.jobs.own("owner", rideId)?.authority.kind).toBe("stopped");
  expect(budget()).toMatchObject({
    shortUsage: 0,
    dayUsage: 0,
    shortPending: 0,
    dayPending: 0,
  });
});

it("sends one POST for two racing SQLite owners and settles the reservation from headers", async () => {
  const { reopen, budget, peer, step, peerStep, rideId } = await uploadFixture();
  await Promise.all([step.submitNext(shutdown), peerStep.submitNext(shutdown)]);
  expect(peer.resources.submitCalls).toBe(1);
  const reopened = reopen();
  expect(reopened.jobs.own("owner", rideId)?.progress).toMatchObject({
    kind: "processing",
    receipt: { uploadId: "12345678901234567890", externalId: `voltonaut-${rideId}.tcx` },
  });
  expect(reopened.credentials.connection("owner")?.workOwner).toBeNull();
  expect(budget()).toMatchObject({
    shortLimit: 100,
    dayLimit: 1000,
    shortUsage: 1,
    dayUsage: 1,
    shortPending: 0,
    dayPending: 0,
  });
});

it("defers without committing an attempt while the durable budget says wait", async () => {
  const { a, peer, step, rideId, time } = await uploadFixture();
  a.db.$client.exec(
    "INSERT OR IGNORE INTO strava_rate_budget(id, short_reset, day_reset, blocked_until) VALUES (1, 900000, 86400000, 900000)",
  );
  await step.submitNext(shutdown);
  expect(peer.resources.submitCalls).toBe(0);
  expect(a.jobs.own("owner", rideId)?.progress).toEqual({ kind: "queued", notBeforeMs: 900000 });
  expect(a.credentials.connection("owner")?.workOwner).toBeNull();
  time.nowMs = 899999;
  expect(a.jobs.prepare(time.nowMs)).toBeUndefined();
});

it.each(["lost", "http", "invalid"] satisfies ("lost" | "http" | "invalid")[])(
  "keeps a %s POST unclear and never sends it again from any owner",
  async (fault) => {
    const { reopen, budget, peer, step, peerStep, rideId, time } = await uploadFixture();
    peer.resources.submission = fault;
    await step.submitNext(shutdown);
    time.nowMs = 40000;
    await Promise.all([step.submitNext(shutdown), peerStep.submitNext(shutdown)]);
    const reopened = reopen();
    expect(reopened.jobs.own("owner", rideId)?.progress.kind).toBe("submission_unknown");
    expect(reopened.jobs.prepare(40000)).toBeUndefined();
    expect(peer.resources.submitCalls).toBe(1);
    expect(budget()).toMatchObject({ dayUsage: 1 });
  },
);

it("polls a known upload to delivery and settles the read reservation", async () => {
  const { a, budget, peer, step, rideId, time } = await uploadFixture();
  await step.submitNext(shutdown);
  peer.resources.processing = "delivered";
  time.nowMs = 21500;
  await step.pollNext(shutdown);
  expect(peer.resources.pollCalls).toBe(1);
  expect(a.jobs.own("owner", rideId)?.progress).toMatchObject({
    kind: "delivered",
    activityId: "321",
  });
  expect(budget()).toMatchObject({
    dayUsage: 2,
    readDayUsage: 2,
    dayPending: 0,
    readDayPending: 0,
  });
});
