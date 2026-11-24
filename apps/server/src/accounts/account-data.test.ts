import { afterEach, expect, it } from "vitest";
import request from "supertest";

import { AccountExportSchema, DEFAULT_RIDER_PROFILE, type RideRecording } from "@voltonaut/shared";
import { hashIdentity, hashToken } from "../auth/tokens.js";
import { RidesService } from "../rides/rides.service.js";
import {
  bearer,
  bodyOf,
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { AccountsService } from "./accounts.service.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";

const cleanup = new Set<() => Promise<void>>();
const NOW_MS = Date.parse("2026-11-24T12:00:00.000Z");
const ORIGIN = "http://localhost:5173";

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

function ride(index: number): RideRecording {
  return {
    schemaVersion: 1,
    rideId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    startedAt: "2026-11-23T12:00:00.000Z",
    metadata: {
      source: "sim",
      routeId: "test-loop",
      routeRevision: "1",
      physicsClockScale: 1,
      profile: DEFAULT_RIDER_PROFILE,
    },
    samples: [
      { elapsedMs: 0, distanceM: 0, powerW: 100, cadenceRpm: 80, gap: false },
      { elapsedMs: 1000, distanceM: 5, powerW: 110, cadenceRpm: 82, gap: false },
    ],
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Test fixture intentionally exposes mutable SQLite and service handles.
function seedAuthAndStrava(db: Readonly<ServerDatabase>, userId: string): void {
  db.$client
    .prepare(
      "INSERT INTO auth_identities (issuer, subject, user_id) VALUES ('https://identity.example', 'owner-subject', ?)",
    )
    .run(userId);
  db.$client
    .prepare(
      "INSERT INTO oidc_handoffs (code_hash, binding_hash, user_id, expires_at) VALUES ('owner-handoff', 'binding', ?, ?)",
    )
    .run(userId, NOW_MS + 60_000);
  db.$client
    .prepare(
      "INSERT INTO strava_connections (user_id, athlete_id, status, encrypted_tokens, access_expires_at, scope, generation) VALUES (?, '123', 'connected', 'private-ciphertext', ?, 'activity:write', 'generation')",
    )
    .run(userId, NOW_MS + 60_000);
  db.$client
    .prepare(
      "INSERT INTO strava_deliveries (delivery_id, user_id, ride_id, authority, progress) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      "00000000-0000-4000-8000-000000000099",
      userId,
      ride(1).rideId,
      JSON.stringify({
        kind: "consented",
        consent: {
          rideId: ride(1).rideId,
          payloadHash: "a".repeat(64),
          exportHash: "b".repeat(64),
          exportVersion: "tcx-1",
          connectionGeneration: "generation",
          athleteId: "123",
          sourcePolicy: "declared_ble_v1",
          noticeRevision: "virtual-ride-1",
        },
        consentedAtMs: NOW_MS,
      }),
      JSON.stringify({ kind: "queued", notBeforeMs: NOW_MS }),
    );
  db.$client
    .prepare("INSERT INTO strava_rate_budget (id, short_reset, day_reset) VALUES (1, ?, ?)")
    .run(NOW_MS + 60_000, NOW_MS + 86_400_000);
}

async function fixture() {
  const context = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => context.app.close());
  const owner = await loginTestUser(context.app, context.mail, "owner@example.com", "127.0.0.1:1");
  const other = await loginTestUser(context.app, context.mail, "other@example.com", "127.0.0.1:2");
  const accounts = context.app.get<AccountsService>(AccountsService);
  const rides = context.app.get<RidesService>(RidesService);
  const db = getDatabase(context.app);

  accounts.putProfile(owner.user.id, { ...DEFAULT_RIDER_PROFILE, displayName: "Owner" }, NOW_MS);
  accounts.putProfile(other.user.id, { ...DEFAULT_RIDER_PROFILE, displayName: "Other" }, NOW_MS);
  accounts.setRole(owner.user.id, { role: "admin" });
  accounts.setMembership(owner.user.id, owner.user.id, { tier: "premium", vip: true });
  rides.store(owner.user.id, ride(1), NOW_MS);
  rides.store(other.user.id, ride(2), NOW_MS);

  seedAuthAndStrava(db, owner.user.id);

  return { ...context, server: httpServerOf(context.app), owner, other, accounts, rides, db };
}

it("requires authentication and never accepts another account as an export or deletion target", async () => {
  const f = await fixture();
  await request(f.server).get("/v1/me/export").expect(401);
  await request(f.server).delete("/v1/me").send({ confirmation: f.owner.user.email }).expect(401);
  await request(f.server)
    .get("/v1/me/export?userId=foreign")
    .set(bearer(f.owner.sessionToken))
    .expect(200);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .send({ confirmation: f.owner.user.email })
    .expect(403);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", "https://foreign.invalid")
    .send({ confirmation: f.owner.user.email })
    .expect(403);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.other.user.email, userId: f.other.user.id })
    .expect(422);
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.other.user.email })
    .expect(403);
  expect(f.accounts.getProfile(f.owner.user.id).status).toBe("present");
});

it("exports every own ride and current account data without sessions or credentials", async () => {
  const f = await fixture();

  for (let index = 3; index <= 55; index += 1) f.rides.store(f.owner.user.id, ride(index), NOW_MS);

  const response = await request(f.server)
    .get("/v1/me/export")
    .set(bearer(f.owner.sessionToken))
    .expect(200);

  const exported = AccountExportSchema.parse(bodyOf(response));

  expect(response.headers["cache-control"]).toBe("no-store");
  expect(exported.account.user).toEqual(f.owner.user);
  expect(exported.account.membership).toEqual({ tier: "premium", vip: true });
  expect(exported.profile).toMatchObject({
    status: "present",
    profile: { displayName: "Owner" },
  });
  expect(exported.rides).toHaveLength(54);
  expect(exported.rides.every((item) => item.receipt.rideId === item.recording.rideId)).toBe(true);
  expect(exported.rides[0]?.stored).toMatchObject({
    uploadedAt: "2026-11-24T12:00:00.000Z",
    durationMs: 1000,
    source: "sim",
    replaySummary: null,
    tcx: null,
  });
  expect(exported.rides.some((item) => item.recording.rideId === ride(2).rideId)).toBe(false);
  expect(exported.inventory).toEqual({ status: "not_stored" });
  expect(exported.progression).toEqual({ status: "not_stored" });
  expect(exported.strava.deliveries).toHaveLength(1);
  expect(response.text).not.toContain(f.owner.sessionToken);
  expect(response.text).not.toContain("private-ciphertext");
  expect(response.text).not.toContain("owner-handoff");
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Assertions intentionally exercise mutable database and service handles.
function assertOwnerPurged(f: Readonly<Fixture>): void {
  const ownerRows = (table: Readonly<string>) =>
    f.db.$client.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(f.owner.user.id);

  for (const table of [
    "profiles",
    "account_status",
    "rides",
    "auth_identities",
    "oidc_handoffs",
    "sessions",
    "strava_transactions",
    "strava_connections",
    "strava_deliveries",
  ])
    expect(ownerRows(table)).toEqual([]);

  expect(
    f.db.$client.prepare("SELECT * FROM login_tokens WHERE email = ?").all(f.owner.user.email),
  ).toEqual([]);
  expect(f.db.$client.prepare("SELECT * FROM strava_rate_budget").all()).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT user_id FROM rides WHERE user_id = ?").all(f.other.user.id),
  ).toHaveLength(1);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Assertions intentionally exercise mutable database handles.
function assertTombstone(f: Readonly<Fixture>): void {
  expect(f.db.$client.prepare("SELECT * FROM auth_identity_tombstones").all()).toEqual([
    { identity_hash: hashIdentity("https://identity.example", "owner-subject") },
  ]);
  expect(
    f.db.$client
      .prepare("SELECT email, deleted_at, deleted_email_hash FROM users WHERE id = ?")
      .get(f.owner.user.id),
  ).toEqual({
    email: `deleted+${f.owner.user.id}@voltonaut.invalid`,
    deleted_at: NOW_MS,
    deleted_email_hash: hashToken(f.owner.user.email),
  });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Negative tests intentionally call mutable service and database handles.
function assertRecreationBlocked(f: Readonly<Fixture>): void {
  expect(() =>
    f.db.$client.prepare("UPDATE users SET deleted_at = NULL WHERE id = ?").run(f.owner.user.id),
  ).toThrow("tombstone is immutable");
  expect(() => f.db.$client.prepare("DELETE FROM users WHERE id = ?").run(f.owner.user.id)).toThrow(
    "tombstone is immutable",
  );
  expect(() => f.accounts.putProfile(f.owner.user.id, DEFAULT_RIDER_PROFILE, NOW_MS)).toThrow(
    "account is deleted",
  );
  expect(() => f.rides.store(f.owner.user.id, ride(3), NOW_MS)).toThrow("account is deleted");
  expect(() =>
    f.db.$client
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES ('late', ?, 0, 0, 1, NULL)",
      )
      .run(f.owner.user.id),
  ).toThrow("account is deleted");
  f.accounts.putProfile(f.other.user.id, DEFAULT_RIDER_PROFILE, NOW_MS);
}

it("deletes only the confirmed owner, revokes sessions and blocks silent recreation", async () => {
  const f = await fixture();

  const deleted = await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: ` ${f.owner.user.email.toUpperCase()} ` })
    .expect(204);

  expect(deleted.headers["cache-control"]).toBe("no-store");
  await request(f.server).get("/v1/me").set(bearer(f.owner.sessionToken)).expect(401);
  await request(f.server).get("/v1/me").set(bearer(f.other.sessionToken)).expect(200);
  assertOwnerPurged(f);
  assertTombstone(f);

  const mailCount = f.mail.readSent().length;
  await request(f.server)
    .post("/v1/auth/magic-link")
    .send({ email: f.owner.user.email })
    .expect(204);
  expect(f.mail.readSent()).toHaveLength(mailCount);
  expect(
    f.db.$client.prepare("SELECT * FROM login_tokens WHERE email = ?").all(f.owner.user.email),
  ).toEqual([]);
  assertRecreationBlocked(f);
});

it("rolls the whole deletion back when any owner purge fails", async () => {
  const f = await fixture();
  f.db.$client.exec(
    "CREATE TRIGGER fail_ride_delete BEFORE DELETE ON rides BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
  );
  await request(f.server)
    .delete("/v1/me")
    .set(bearer(f.owner.sessionToken))
    .set("Origin", ORIGIN)
    .send({ confirmation: f.owner.user.email })
    .expect(500);

  expect(f.accounts.getProfile(f.owner.user.id).status).toBe("present");
  expect(f.rides.list(f.owner.user.id, { limit: 20 }).rides).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT deleted_at FROM users WHERE id = ?").get(f.owner.user.id),
  ).toEqual({ deleted_at: null });
  await request(f.server).get("/v1/me").set(bearer(f.owner.sessionToken)).expect(200);
});
