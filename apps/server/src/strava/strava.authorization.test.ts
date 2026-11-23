import { expect, it } from "vitest";
import { schedulerFixture } from "./strava.scheduler-fixture.spec.js";
import { accepted, consent, gate, required } from "./strava.delivery-fixture.spec.js";
import { encryptTokens } from "./strava.crypto.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { stravaTables } from "../schema.js";
import {
  nativeBudgetAttack,
  nativeBudgetDiagnostic,
} from "./strava.native-budget-diagnostic.spec.js";

async function setup(authorizationTransport: "http" | "in_process" = "http") {
  const state = await schedulerFixture(authorizationTransport);
  state.a.db.$client
    .prepare("UPDATE strava_connections SET encrypted_tokens = ? WHERE user_id = 'owner'")
    .run(encryptTokens(state.grant.tokens, state.config.strava.tokenKey, "owner", "42"));

  state.rates.reserve("poll", state.time.nowMs);
  state.rates.observe(
    new Headers({
      "X-RateLimit-Limit": "100,1000",
      "X-RateLimit-Usage": "1,1",
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": "1,1",
    }),
    200,
    state.time.nowMs,
    state.time.nowMs,
    "poll",
  );

  return state;
}

it("keeps a later known upload pollable after a day of forged hints", async () => {
  const diagnostic = nativeBudgetDiagnostic();

  const { reopen, scheduler, peer, time, policy } = await nativeBudgetAttack(
    () => setup("in_process"),
    diagnostic,
  );

  const reopened = reopen();
  const known = accepted(reopened, "owner", consent, time.nowMs);
  diagnostic.checkpoint("reopen_accepted");
  time.nowMs += 20000;
  peer.resources.processing = "delivered";
  await scheduler.tick();
  diagnostic.checkpoint("late_poll");
  expect(peer.resources.pollCalls).toBe(1);
  expect(peer.resources.submitCalls).toBe(0);
  expect(peer.resources.athleteCalls).toBeGreaterThan(0);
  expect(peer.resources.athleteCalls).toBeLessThanOrEqual(500);
  expect(peer.resources.athleteCalls).toBe(1);
  expect(peer.resources.refreshCalls).toBe(1);
  expect(policy.athleteCalls).toBeGreaterThan(0);
  expect(policy.athleteCalls).toBeLessThanOrEqual(500);
  expect(policy.athleteCalls).toBe(499);
  expect(reopened.credentials.connection("owner")?.authorizationCheckAfter).toBe(86400000);
  expect(reopened.credentials.connection("owner")).toMatchObject({
    authorizationCheckedRevision: 499,
    tokenRevision: 1,
  });
  expect(reopened.jobs.own("owner", consent.rideId)).toMatchObject({
    authority: known.authority,
    progress: {
      kind: "delivered",
      receipt: { uploadId: "12345678901234567890" },
    },
  });
  expect(reopened.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortLimit: 100,
    dayLimit: 1000,
    readShortLimit: 100,
    readDayLimit: 1000,
    dayUsage: 501,
    readDayUsage: 501,
    dayPending: 0,
    readDayPending: 0,
  });
});

it("skips a busy oldest hint and proves an eligible second connection", async () => {
  const { a, hints, authorization, peer, grant, config } = await setup();
  a.db.$client.exec("INSERT INTO users VALUES ('other','other@example.test',0,NULL)");
  a.db.$client
    .prepare(
      "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation,authorization_hint_revision,authorization_check_after) VALUES ('other','43','connected',?,999999,'activity:write','other-generation',1,1)",
    )
    .run(encryptTokens(grant.tokens, config.strava.tokenKey, "other", "43"));
  hints.hint("42");
  const busy = required(a.credentials.claimWork("owner", "poll", 20000));
  await authorization.tick(AbortSignal.timeout(2000));
  expect(peer.resources.athleteCalls).toBe(1);
  expect(a.credentials.connection("owner")?.workOwner).toBe(busy.workOwner);
  expect(a.credentials.connection("other")?.authorizationCheckAfter).toBe(80000);
});

it("coalesces persistent hints, preserves cooldown under flood and lets accepted polls run first", async () => {
  const { a, reopen, hints, authorization, peer, scheduler, time } = await setup();
  const job = accepted(a, "owner", consent, 1000);
  hints.hint("42");
  hints.hint("42");
  peer.resources.processing = "delivered";
  await scheduler.tick();
  expect(a.jobs.own("owner", consent.rideId)?.progress.kind).toBe("delivered");
  expect(peer.resources.submitCalls).toBe(0);
  expect(peer.resources.pollCalls).toBe(1);
  expect(peer.resources.athleteCalls).toBe(1);
  expect(reopen().credentials.connection("owner")).toMatchObject({
    authorizationHintRevision: 2,
    authorizationCheckedRevision: 2,
    authorizationCheckAfter: 80000,
  });

  for (let index = 0; index < 100; index += 1) hints.hint("42");
  expect(hints.next(79999)).toBeUndefined();
  await authorization.tick(AbortSignal.timeout(2000));
  expect(peer.resources.athleteCalls).toBe(1);
  time.nowMs = 80000;
  await authorization.tick(AbortSignal.timeout(2000));
  expect(peer.resources.athleteCalls).toBe(2);
  expect(reopen().credentials.connection("owner")?.authorizationCheckedRevision).toBe(102);
  expect(a.jobs.own("owner", consent.rideId)?.authority).toEqual(job.authority);
});

it("acknowledges only captured revisions when a newer hint arrives during provider proof", async () => {
  const { a, b, reopen, hints, authorization, peer } = await setup();
  const entered = gate();
  const resume = gate();
  peer.resources.athleteGate = { enter: entered.release, wait: resume.wait };
  hints.hint("42");
  const pending = authorization.tick(AbortSignal.timeout(2000));

  try {
    await entered.wait;
    new StravaAuthorizationStore(b.db, stravaTables).hint("42");
    expect(b.credentials.claimWork("owner", "submit", 20000)).toBeUndefined();
    resume.release();
    await pending;
    expect(reopen().credentials.connection("owner")).toMatchObject({
      authorizationHintRevision: 2,
      authorizationCheckedRevision: 1,
      credentialState: "available",
    });
    expect(a.jobs.prepare(20000)).toBeUndefined();
  } finally {
    resume.release();
    await pending;
  }
});

it("does not start proof against a generation replaced between readiness and claiming its lease", async () => {
  const { a, b, hints, authorization, peer } = await setup();
  hints.hint("42");
  const pending = authorization.tick(AbortSignal.timeout(2000));
  b.db.$client.exec(
    "UPDATE strava_connections SET generation='generation-new', authorization_hint_revision=0, authorization_checked_revision=0, authorization_check_after=0",
  );
  await pending;
  expect(peer.resources.athleteCalls).toBe(0);
  expect(a.credentials.connection("owner")).toMatchObject({
    generation: "generation-new",
    workOwner: null,
    authorizationHintRevision: 0,
    authorizationCheckedRevision: 0,
    authorizationCheckAfter: 0,
  });
});

it.each(["foreign", "http", "lost"] satisfies ("foreign" | "http" | "lost")[])(
  "defers %s proof without acknowledging or revoking and retains encrypted credentials",
  async (fault) => {
    const { a, reopen, hints, authorization, peer } = await setup();
    const before = required(a.credentials.connection("owner"));
    peer.resources.athleteFault = fault;
    hints.hint("42");
    await authorization.tick(AbortSignal.timeout(2000));
    expect(reopen().credentials.connection("owner")).toMatchObject({
      credentialState: "available",
      encryptedTokens: before.encryptedTokens,
      authorizationHintRevision: 1,
      authorizationCheckedRevision: 0,
      authorizationCheckAfter: 80000,
    });
    expect(peer.resources.refreshCalls).toBe(0);
  },
);

it.each<{
  readonly expiresAt: number;
  readonly fault: "none" | "unauthorized";
  readonly checked: number;
}>([
  { expiresAt: 0, fault: "none", checked: 1 },
  { expiresAt: 999999, fault: "unauthorized", checked: 0 },
])(
  "coordinates refresh for expiry=$expiresAt and fault=$fault without calling a 401 a revocation",
  async ({ expiresAt, fault, checked }) => {
    const { a, reopen, hints, authorization, peer, time } = await setup();

    a.db.$client.prepare("UPDATE strava_connections SET access_expires_at = ?").run(expiresAt);
    peer.resources.athleteFault = fault;
    hints.hint("42");
    await authorization.tick(AbortSignal.timeout(2000));
    expect(peer.resources.refreshCalls).toBe(1);
    expect(reopen().credentials.connection("owner")).toMatchObject({
      generation: "generation-a",
      credentialState: "available",
      tokenRevision: 1,
      authorizationCheckedRevision: checked,
    });
    peer.resources.athleteFault = "none";
    time.nowMs = 80000;
    await authorization.tick(AbortSignal.timeout(2000));
    expect(reopen().credentials.connection("owner")?.authorizationCheckedRevision).toBe(1);
  },
);

it.each([
  { status: 400, body: "{}" },
  { status: 401, body: '{"message":"Authorization Error"}' },
  {
    status: 400,
    body: '{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}',
  },
  { status: 400, body: '{"error":"invalid_grant"}' },
  {
    status: 400,
    body: '{"errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"},{"resource":"Application","field":"client_secret","code":"invalid"}]}',
  },
])(
  "never treats unverified synthetic refresh wire $status/$body as confirmed deauthorization",
  async (response: { readonly status: number; readonly body: string }) => {
    const { a, reopen, hints, authorization, peer } = await setup();
    const known = accepted(a, "owner", consent, 1000);
    a.db.$client.exec("UPDATE strava_connections SET access_expires_at = 0");
    peer.resources.refreshResponse = response;
    hints.hint("42");
    await authorization.tick(AbortSignal.timeout(2000));
    expect(reopen().credentials.connection("owner")).toMatchObject({
      credentialState: "uncertain",
      authorizationCheckedRevision: 0,
    });
    expect(a.jobs.own("owner", consent.rideId)).toMatchObject({
      authority: { kind: "stopped", reason: "credentials" },
      progress: known.progress,
    });
    expect(peer.resources.submitCalls).toBe(0);
  },
);

it("fences late proof and late refresh failure from a newer generation and its delivery", async () => {
  const { a, b, hints, authorization, peer } = await setup();
  const old = required(a.credentials.claimWork("owner", "refresh", 1000));
  b.db.$client.exec(
    "UPDATE strava_connections SET generation='generation-new', work_owner=NULL, work_kind=NULL, work_until=0, credential_state='available'",
  );
  const currentConsent = { ...consent, connectionGeneration: "generation-new" };
  a.jobs.enqueue("owner", currentConsent, 20000);
  expect(a.credentials.finishRefresh(old, { kind: "refused" })).toBe(false);
  a.jobs.stop("owner", "credentials", 20000, old.generation);
  expect(a.jobs.own("owner", consent.rideId)?.authority.kind).toBe("consented");
  const entered = gate();
  const resume = gate();
  peer.resources.athleteGate = { enter: entered.release, wait: resume.wait };
  hints.hint("42");
  const pending = authorization.tick(AbortSignal.timeout(2000));

  try {
    await entered.wait;
    b.db.$client.exec(
      "UPDATE strava_connections SET generation='generation-newer', authorization_hint_revision=0, authorization_checked_revision=0, authorization_check_after=0, work_owner=NULL, work_kind=NULL, work_until=0",
    );
    resume.release();
    await pending;
    expect(a.credentials.connection("owner")).toMatchObject({
      generation: "generation-newer",
      authorizationCheckedRevision: 0,
      authorizationCheckAfter: 0,
    });
  } finally {
    resume.release();
    await pending;
  }
});
