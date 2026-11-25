import { expect, expectTypeOf, it } from "vitest";
import { schedulerFixture, uploadFixture } from "./strava.scheduler-fixture.spec.js";
import { encryptTokens } from "./strava.crypto.js";
import { stravaTables } from "../schema.js";
import type { CommittedAttempt } from "./strava.delivery-store.js";
import type { SubmittingDelivery } from "./strava.delivery-state.js";
import type { StravaProvider } from "./strava.provider.js";

const shutdown = new AbortController().signal;

/** The type of `{ ...attempt, externalId }`: spread keeps public members and drops `#` fields. */
type SpreadCopy = {
  readonly [Key in keyof CommittedAttempt]: CommittedAttempt[Key];
} & { readonly externalId: string };

it("only accepts a store-committed attempt as provider upload input", () => {
  expectTypeOf<{
    readonly delivery: SubmittingDelivery;
    readonly externalId: string;
  }>().not.toExtend<CommittedAttempt>();
  expectTypeOf<SpreadCopy>().not.toExtend<CommittedAttempt>();
  expectTypeOf<
    Parameters<StravaProvider["submit"]>[0]["attempt"]
  >().toEqualTypeOf<CommittedAttempt>();
});

it("releases the upload reservation when another owner stops the prepared ride so dispatch refuses the commit", async () => {
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

// The dispatch-commit race itself is proven in strava.delivery-store.test.ts.
it("lets only one of two concurrently ticking SQLite owners prepare and POST, settled from headers", async () => {
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

it("cools down an undecryptable hint so a healthy hinted connection is still checked", async () => {
  const { a, reopen, grant, config, hints, rates, peer, step, time } = await schedulerFixture();
  rates.reserve("poll", time.nowMs);
  rates.observe(
    new Headers({
      "X-RateLimit-Limit": "100,1000",
      "X-RateLimit-Usage": "1,1",
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": "1,1",
    }),
    200,
    time.nowMs,
    time.nowMs,
    "poll",
  );
  a.db.$client.exec(
    "INSERT INTO users (id, email, created_at, deleted_at) VALUES ('other','other@example.test',0,NULL)",
  );
  a.db.$client
    .prepare(
      "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation,authorization_hint_revision,authorization_check_after) VALUES ('other','43','connected',?,999999,'activity:write','other-generation',1,1)",
    )
    .run(encryptTokens(grant.tokens, config.strava.tokenKey, "other", "43"));
  hints.hint("42");
  peer.control.athleteId = 43;
  await expect(step.checkNextHint(shutdown)).rejects.toBeInstanceOf(SyntaxError);
  await step.checkNextHint(shutdown);
  await step.checkNextHint(shutdown);
  const reopened = reopen();
  expect(peer.resources.athleteCalls).toBe(1);
  expect(reopened.credentials.connection("other")).toMatchObject({
    authorizationCheckedRevision: 1,
    authorizationCheckAfter: 80000,
  });
  expect(reopened.credentials.connection("owner")).toMatchObject({
    authorizationCheckedRevision: 0,
    authorizationCheckAfter: 80000,
    workOwner: null,
  });
  expect(reopened.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortPending: 0,
    dayPending: 0,
    readShortPending: 0,
    readDayPending: 0,
  });
});
