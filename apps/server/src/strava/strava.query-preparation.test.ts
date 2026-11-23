import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
import { stravaTables } from "../schema.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { StravaCredentialStore } from "./strava.credential-store.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { accepted, consent, fixture, required } from "./strava.delivery-fixture.spec.js";

it("keeps constructors inert and retries failed first preparation after schema arrival", () => {
  const client = new Database(":memory:");

  try {
    const db = drizzle(client);
    const hints = new StravaAuthorizationStore(db, stravaTables);
    const credentials = new StravaCredentialStore(db, stravaTables);
    const jobs = new StravaDeliveryStore(db, stravaTables);
    const rates = new StravaRateStore(db, stravaTables);
    expect(() => hints.next(0)).toThrow("no such table");
    expect(() => credentials.connection("missing")).toThrow("no such table");
    expect(() => jobs.nextPoll(0)).toThrow("no such table");
    expect(() => rates.reserve("poll", 0)).toThrow("no such table");
    migrate(db, { migrationsFolder: new URL("../../drizzle/", import.meta.url).pathname });
    expect(credentials.connection("missing")).toBeUndefined();
  } finally {
    client.close();
  }
});

it("reads later inserts, fresh IDs and peer token generations without retaining rows", () => {
  const { a, b, reopen } = fixture();
  expect(a.credentials.connection("other")).toBeUndefined();
  b.db.$client.exec("INSERT INTO users VALUES ('other','other@example.test',0,NULL)");
  b.db.$client.exec(
    "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation) VALUES ('other','43','connected','other-encrypted',2000000,'activity:write','generation-b')",
  );
  expect(a.credentials.connection("other")).toMatchObject({
    athleteId: "43",
    generation: "generation-b",
  });
  const original = required(a.credentials.connection("owner"));
  b.db.$client.exec(
    "UPDATE strava_connections SET generation='generation-new',token_revision=7,encrypted_tokens='rotated' WHERE user_id='owner'",
  );
  expect(a.credentials.connection("owner")).toMatchObject({
    generation: "generation-new",
    tokenRevision: 7,
    encryptedTokens: "rotated",
  });
  expect(original).toMatchObject({
    generation: "generation-a",
    tokenRevision: 0,
    encryptedTokens: "encrypted",
  });
  a.db.$client.close();
  expect(reopen().credentials.connection("owner")?.tokenRevision).toBe(7);
  expect(b.credentials.connection("other")?.athleteId).toBe("43");
});

it("binds current lease deadlines and owners and rejects stale release fences", async () => {
  const { a, b } = fixture();

  const claims = await Promise.all([
    Promise.resolve().then(() => a.credentials.claimWork("owner", "poll", 100)),
    Promise.resolve().then(() => b.credentials.claimWork("owner", "poll", 100)),
  ]);

  expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
  const first = required(claims.find((claim) => claim !== undefined));
  expect(first).toMatchObject({ workUntil: 10100, workKind: "poll" });
  a.credentials.releaseWork(first);
  const second = required(a.credentials.claimWork("owner", "submit", 200));
  expect(second.workOwner).not.toBe(first.workOwner);
  expect(second).toMatchObject({ workUntil: 10200, workKind: "submit" });
  a.credentials.releaseWork(first);
  expect(b.credentials.connection("owner")?.workOwner).toBe(second.workOwner);
  b.db.$client.exec(
    "UPDATE strava_connections SET generation='new',token_revision=2 WHERE user_id='owner'",
  );
  a.credentials.releaseWork(second);
  expect(b.credentials.connection("owner")?.workOwner).toBe(second.workOwner);
  const current = required(b.credentials.connection("owner"));
  b.credentials.releaseWork(current);
  const refresh = required(a.credentials.claimWork("owner", "refresh", 300));
  a.credentials.recover(10299);
  expect(b.credentials.connection("owner")?.credentialState).toBe("refreshing");
  a.credentials.recover(10300);
  expect(b.credentials.connection("owner")?.credentialState).toBe("uncertain");
  expect(refresh.workOwner).not.toBe(second.workOwner);
});

it("acknowledges only the captured hint and preserves separate deferred SET semantics", () => {
  const { a, b, reopen } = fixture();
  const hints = new StravaAuthorizationStore(a.db, stravaTables);
  const peer = new StravaAuthorizationStore(b.db, stravaTables);
  expect(hints.next(100)).toBeUndefined();
  hints.hint("not-this-athlete");
  expect(hints.next(100)).toBeUndefined();
  hints.hint("42");
  expect(hints.next(100)?.authorizationHintRevision).toBe(1);
  const first = required(a.credentials.claimWork("owner", "poll", 100));
  peer.hint("42");
  hints.defer(first, 200, true);
  a.credentials.releaseWork(first);
  expect(hints.next(199)).toBeUndefined();
  expect(hints.next(200)).toMatchObject({
    authorizationHintRevision: 2,
    authorizationCheckedRevision: 1,
  });
  const second = required(a.credentials.claimWork("owner", "poll", 200));
  hints.defer(second, 300, false);
  a.credentials.releaseWork(second);
  expect(hints.next(299)).toBeUndefined();
  expect(hints.next(300)?.authorizationCheckedRevision).toBe(1);
  const third = required(a.credentials.claimWork("owner", "poll", 300));
  hints.defer(second, 999, true);
  expect(a.credentials.connection("owner")?.authorizationCheckAfter).toBe(300);
  hints.defer(third, 400, true);
  a.credentials.releaseWork(third);
  expect(hints.next(400)).toBeUndefined();
  const restarted = reopen();
  new StravaAuthorizationStore(restarted.db, stravaTables).hint("42");
  expect(hints.next(400)?.authorizationHintRevision).toBe(3);
});

it("sees new work after empty scans and binds changing delivery scan times", () => {
  const { a, b } = fixture();
  expect(a.jobs.prepare(100)).toBeUndefined();
  expect(a.jobs.nextPoll(100)).toBeUndefined();
  b.jobs.enqueue("owner", consent, 200);
  expect(a.jobs.prepare(199)).toBeUndefined();
  const first = required(a.jobs.prepare(200));
  expect(b.jobs.prepare(10199)).toBeUndefined();
  const recovered = required(a.jobs.prepare(10200));
  expect(recovered.progress).not.toEqual(first.progress);
  a.jobs.defer(recovered, 10300);
  const processing = accepted(b, "owner", consent, 10300);
  expect(processing.progress.kind).toBe("processing");
  expect(a.jobs.nextPoll(10300)).toBeUndefined();
  expect(a.jobs.nextPoll(30300)?.deliveryId).toBe(processing.deliveryId);
});

it("keeps prepared operations inside immediate transactions and rolls back state, not plans", () => {
  const { a, b } = fixture();
  const hints = new StravaAuthorizationStore(a.db, stravaTables);
  expect(() =>
    a.db.transaction(
      () => {
        hints.hint("42");
        expect(hints.next(100)?.authorizationHintRevision).toBe(1);
        const claim = required(a.credentials.claimWork("owner", "poll", 100));
        expect(a.credentials.connection("owner")?.workOwner).toBe(claim.workOwner);
        throw new Error("rollback probe");
      },
      { behavior: "immediate" },
    ),
  ).toThrow("rollback probe");
  expect(b.credentials.connection("owner")).toMatchObject({
    authorizationHintRevision: 0,
    workOwner: null,
  });
  hints.hint("42");
  expect(hints.next(200)?.authorizationHintRevision).toBe(1);
  expect(a.credentials.claimWork("owner", "poll", 200)?.workUntil).toBe(10200);
});

it.each([
  "UPDATE strava_connections SET generation='new-generation' WHERE user_id='owner'",
  "UPDATE strava_connections SET token_revision=2 WHERE user_id='owner'",
  "UPDATE strava_connections SET work_owner='new-owner' WHERE user_id='owner'",
])("preserves each stale authorization and release fence after %s", (change: string) => {
  const { a, b } = fixture();
  const hints = new StravaAuthorizationStore(a.db, stravaTables);
  hints.hint("42");
  const first = required(a.credentials.claimWork("owner", "poll", 100));
  hints.defer(first, 200, false);
  b.db.$client.exec(change);
  hints.defer(first, 999, true);
  a.credentials.releaseWork(first);
  expect(b.credentials.connection("owner")).toMatchObject({
    authorizationCheckedRevision: 0,
    authorizationCheckAfter: 200,
    workKind: "poll",
  });
});

it("reuses recovery scans without freezing submitting lease times", () => {
  const { a, b } = fixture();
  a.jobs.recover(100);
  b.jobs.enqueue("owner", consent, 200);
  const preparing = required(b.jobs.prepare(200));
  const work = required(b.credentials.claimWork("owner", "submit", 200));
  b.jobs.dispatch(preparing, work, consent, 200);
  a.jobs.recover(10199);
  expect(b.jobs.own("owner", consent.rideId)?.progress.kind).toBe("submitting");
  a.jobs.recover(10200);
  expect(b.jobs.own("owner", consent.rideId)?.progress.kind).toBe("submission_unknown");
});

it("keeps fresh budget bindings, peer reservations and late-window accounting after reuse", () => {
  const { a, b, reopen } = fixture();
  const rates = new StravaRateStore(a.db, stravaTables);
  const peer = new StravaRateStore(b.db, stravaTables);
  rates.observe(new Headers(), 200, 100, 100, "poll");
  expect(rates.reserve("poll", 100)).toEqual({ kind: "reserved" });
  rates.observe(
    new Headers({ "X-RateLimit-Limit": "4,8", "X-ReadRateLimit-Limit": "4,8" }),
    200,
    100,
    100,
    "poll",
  );
  expect(peer.reserve("authorization_hint", 101)).toEqual({ kind: "reserved" });
  expect(rates.reserve("authorization_hint", 102)).toEqual({ kind: "wait", untilMs: 900000 });
  expect(rates.reserve("poll", 103)).toEqual({ kind: "reserved" });
  expect(new StravaRateStore(reopen().db, stravaTables).reserve("poll", 86400000)).toEqual({
    kind: "reserved",
  });
  rates.observe(
    new Headers({ "X-RateLimit-Usage": "4,8", "X-ReadRateLimit-Usage": "4,8" }),
    200,
    100,
    86400001,
    "poll",
  );
  expect(a.db.select().from(stravaTables.rateBudget).get()).toMatchObject({
    shortUsage: 1,
    dayUsage: 1,
    readShortUsage: 1,
    readDayUsage: 1,
    shortPending: 1,
    dayPending: 1,
    shortReset: 87300000,
    dayReset: 172800000,
  });
  expect(rates.reserve("authorization_hint", 86400002)).toEqual({ kind: "reserved" });
});
