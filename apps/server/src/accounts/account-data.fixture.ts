import { afterEach, expect } from "vitest";
import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import {
  DEFAULT_RIDER_PROFILE,
  VoltsDebitCommandSchema,
  VoltsRideRangeCommandSchema,
  type RideRecording,
} from "@voltonaut/shared";
import { hashDeletedEmail, hashIdentity, hashToken } from "../auth/tokens.js";
import { RidesService } from "../rides/rides.service.js";
import { EconomyService } from "../economy/economy.service.js";
import {
  createTestApp,
  getDatabase,
  httpServerOf,
  loginTestUser,
} from "../testing/test-app.spec.js";
import { AccountsService } from "./accounts.service.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { userOwnedTables } from "../testing/user-owned-tables.js";

const cleanup = new Set<() => Promise<void>>();
export const NOW_MS = Date.parse("2026-11-24T12:00:00.000Z");
export const ORIGIN = "http://localhost:5173";

afterEach(async () => {
  await Promise.all([...cleanup].map((close) => close()));
  cleanup.clear();
});

export function ride(index: number): RideRecording {
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

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Test fixture intentionally exposes mutable SQLite handles.
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

function reward(journalId: string, energyKj: number) {
  return VoltsRideRangeCommandSchema.parse({
    journalId,
    startTick: 0,
    endTick: 1,
    rewardDay: "2026-11-24",
    cumulativeFacts: {
      activeDistanceM: 0,
      activeElevationGainM: 0,
      activeTimeS: 0,
      elevationGainM: 0,
      energyKj,
    },
  });
}

function seedVolts(economy: Readonly<EconomyService>, ownerId: string, otherId: string): void {
  economy.creditRideRange(ownerId, reward("20000000-0000-4000-8000-000000000001", 20));
  economy.debit(
    ownerId,
    VoltsDebitCommandSchema.parse({
      idempotencyKey: "purchase:item-one",
      refId: "item-one",
      amountVolts: 8,
    }),
  );
  economy.creditRideRange(otherId, reward("20000000-0000-4000-8000-000000000002", 7));
}

function seedInventoryAndGrant(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Test fixture intentionally exposes mutable SQLite handles.
  db: Readonly<ServerDatabase>,
  ownerId: string,
  otherId: string,
): void {
  const insert = db.$client.prepare(
    "INSERT INTO inventory (user_id, item_id, source, purchase_request_id, acquired_at) VALUES (?, 'jersey.stripe', 'shop', ?, ?)",
  );

  insert.run(ownerId, "30000000-0000-4000-8000-000000000001", NOW_MS);
  insert.run(otherId, "30000000-0000-4000-8000-000000000002", NOW_MS);

  const equip = db.$client.prepare(
    "INSERT INTO avatar_loadouts (user_id, loadout_json, updated_at) VALUES (?, ?, ?)",
  );

  equip.run(ownerId, JSON.stringify(DEFAULT_AVATAR_CONFIG), NOW_MS);
  equip.run(otherId, JSON.stringify(DEFAULT_AVATAR_CONFIG), NOW_MS);
  db.$client
    .prepare(
      "INSERT INTO volts_ledger (id, user_id, delta_volts, reason, ref_id, idempotency_key, payload_hash, created_at) VALUES ('30000000-0000-4000-8000-000000000003', ?, 5, 'operator_grant', 'acceptance', 'operator:acceptance', ?, ?)",
    )
    .run(ownerId, "c".repeat(64), NOW_MS);
  // The other account issued the owner's credit; the owner's export must not reveal it (issue #116).
  db.$client
    .prepare(
      "INSERT INTO volts_grant_operators (entry_id, operator_user_id, provenance, recorded_at) VALUES ('30000000-0000-4000-8000-000000000003', ?, 'recorded', ?)",
    )
    .run(otherId, NOW_MS);
  // The owner issued a credit to the other account; deleting the owner must keep that audit row.
  db.$client
    .prepare(
      "INSERT INTO volts_ledger (id, user_id, delta_volts, reason, ref_id, idempotency_key, payload_hash, created_at) VALUES ('30000000-0000-4000-8000-000000000004', ?, 3, 'operator_grant', 'acceptance', 'operator:acceptance', ?, ?)",
    )
    .run(otherId, "d".repeat(64), NOW_MS);
  db.$client
    .prepare(
      "INSERT INTO volts_grant_operators (entry_id, operator_user_id, provenance, recorded_at) VALUES ('30000000-0000-4000-8000-000000000004', ?, 'recorded', ?)",
    )
    .run(ownerId, NOW_MS);
}

export async function accountDataFixture() {
  const context = await createTestApp({ clock: { nowMs: () => NOW_MS } });
  cleanup.add(() => context.app.close());
  const owner = await loginTestUser(context.app, context.mail, "owner@example.com", "127.0.0.1:1");
  const other = await loginTestUser(context.app, context.mail, "other@example.com", "127.0.0.1:2");
  const accounts = context.app.get<AccountsService>(AccountsService);
  const rides = context.app.get<RidesService>(RidesService);
  const economy = context.app.get<EconomyService>(EconomyService);
  const db = getDatabase(context.app);

  accounts.putProfile(owner.user.id, { ...DEFAULT_RIDER_PROFILE, displayName: "Owner" }, NOW_MS);
  accounts.putProfile(other.user.id, { ...DEFAULT_RIDER_PROFILE, displayName: "Other" }, NOW_MS);
  accounts.setRole(owner.user.id, { role: "admin" });
  accounts.setMembership(owner.user.id, owner.user.id, { tier: "premium", vip: true });
  rides.store(owner.user.id, ride(1), NOW_MS);
  rides.store(other.user.id, ride(2), NOW_MS);
  seedVolts(economy, owner.user.id, other.user.id);
  seedInventoryAndGrant(db, owner.user.id, other.user.id);
  seedAuthAndStrava(db, owner.user.id);

  return {
    ...context,
    server: httpServerOf(context.app),
    owner,
    other,
    accounts,
    rides,
    economy,
    db,
  };
}

export type AccountDataFixture = Awaited<ReturnType<typeof accountDataFixture>>;

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Assertions intentionally exercise mutable database and service handles.
export function assertOwnerPurged(f: Readonly<AccountDataFixture>): void {
  const ownerRows = (table: Readonly<string>) =>
    f.db.$client.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(f.owner.user.id);

  for (const table of userOwnedTables(f.db)) expect(ownerRows(table)).toEqual([]);

  expect(
    f.db.$client.prepare("SELECT * FROM login_tokens WHERE email = ?").all(f.owner.user.email),
  ).toEqual([]);
  expect(f.db.$client.prepare("SELECT * FROM strava_rate_budget").all()).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT user_id FROM rides WHERE user_id = ?").all(f.other.user.id),
  ).toHaveLength(1);
  expect(
    f.db.$client.prepare("SELECT user_id FROM volts_ledger WHERE user_id = ?").all(f.other.user.id),
  ).toHaveLength(2);
  expect(
    f.db.$client.prepare("SELECT user_id FROM inventory WHERE user_id = ?").all(f.other.user.id),
  ).toHaveLength(1);
  expect(
    f.db.$client
      .prepare("SELECT user_id FROM avatar_loadouts WHERE user_id = ?")
      .all(f.other.user.id),
  ).toHaveLength(1);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Assertions intentionally exercise mutable database handles.
export function assertTombstone(f: Readonly<AccountDataFixture>): void {
  const hmacKey = f.config.auth.tombstoneHmacKey;
  expect(f.db.$client.prepare("SELECT * FROM auth_identity_tombstones").all()).toEqual([
    { identity_hash: hashIdentity(hmacKey, "https://identity.example", "owner-subject") },
  ]);
  expect(
    f.db.$client
      .prepare("SELECT email, deleted_at, deleted_email_hash FROM users WHERE id = ?")
      .get(f.owner.user.id),
  ).toEqual({
    email: `deleted+${f.owner.user.id}@voltonaut.invalid`,
    deleted_at: NOW_MS,
    deleted_email_hash: hashDeletedEmail(hmacKey, f.owner.user.email),
  });
  expect(
    f.db.$client.prepare("SELECT deleted_email_hash FROM users WHERE id = ?").get(f.owner.user.id),
  ).not.toEqual({ deleted_email_hash: hashToken(f.owner.user.email) });
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Negative tests intentionally call mutable service and database handles.
export function assertRecreationBlocked(f: Readonly<AccountDataFixture>): void {
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
  expect(() =>
    f.economy.creditRideRange(f.owner.user.id, reward("20000000-0000-4000-8000-000000000003", 1)),
  ).toThrow("account is deleted");
  expect(() =>
    f.db.$client
      .prepare("UPDATE volts_ledger SET user_id = ? WHERE user_id = ?")
      .run(f.owner.user.id, f.other.user.id),
  ).toThrow("account is deleted");
  f.accounts.putProfile(f.other.user.id, DEFAULT_RIDER_PROFILE, NOW_MS);
}
