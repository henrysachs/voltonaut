import { join } from "node:path";
import request from "supertest";
import { expect, it } from "vitest";

import { createTestApp, getDatabase, httpServerOf, bodyOf } from "../testing/test-app.spec.js";
import { LEGACY_TEST_PROVIDER, seedLegacySession } from "../testing/legacy-account.js";
import {
  MIGRATIONS_DIR,
  expectHead,
  scratchDirectory,
  seedOwners,
  upgradeFrom,
} from "../testing/migration-harness.spec.js";
import { createToken } from "../auth/tokens.js";
import { createDatabase } from "./drizzle.provider.js";
import { testServerConfig } from "../config.js";

it("creates owned tables, enforces foreign keys and closes on Nest shutdown", async () => {
  const { app } = await createTestApp();
  const db = getDatabase(app);

  const tables = db.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();

  expect(tables).toEqual(
    [
      "__drizzle_migrations",
      "account_status",
      "auth_identities",
      "auth_identity_tombstones",
      "avatar_loadouts",
      "inventory",
      "login_tokens",
      "oidc_handoffs",
      "oidc_transactions",
      "profiles",
      "progress_consents",
      "ride_progress_journals",
      "ride_progress_ranges",
      "rides",
      "sessions",
      "strava_connections",
      "strava_deliveries",
      "strava_rate_budget",
      "strava_transactions",
      "users",
      "volts_grant_operators",
      "volts_ledger",
    ].map((name) => ({ name })),
  );
  expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(() =>
    db.$client
      .prepare(
        "INSERT INTO sessions (token_hash,user_id,created_at,last_seen_at,expires_at) VALUES ('hash', 'missing', 0, 0, 100)",
      )
      .run(),
  ).toThrow("FOREIGN KEY");
  await app.close();
  expect(db.$client.open).toBe(false);
});

it("persists with WAL, creates the data directory and applies migrations idempotently", async () => {
  const directory = scratchDirectory("auth-db");

  const config = {
    database: { path: join(directory, "data", "auth.db"), migrationsDir: MIGRATIONS_DIR },
  };

  const first = await createTestApp({ config });
  const db = getDatabase(first.app);
  expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
  const migrations = db.$client.prepare("SELECT * FROM __drizzle_migrations").all();
  expectHead(db);
  seedOwners(db, [{ id: "persisted", email: "persist@example.com" }]);
  await first.app.close();
  const second = await createTestApp({ config });
  expect(getDatabase(second.app).$client.prepare("SELECT id FROM users").all()).toEqual([
    { id: "persisted" },
  ]);
  expect(
    getDatabase(second.app).$client.prepare("SELECT * FROM __drizzle_migrations").all(),
  ).toEqual(migrations);
  await second.app.close();
});

it("fails startup with missing migrations instead of creating an empty application database", () => {
  expect(() =>
    createDatabase(
      testServerConfig({
        database: { path: ":memory:", migrationsDir: "/missing-voltonaut-migrations" },
      }),
    ),
  ).toThrow(/.+/u);
});

it("keeps health public and returns a safe 503 envelope when the database closes", async () => {
  const { app } = await createTestApp();
  await request(httpServerOf(app)).get("/healthz").expect(200);
  getDatabase(app).$client.close();
  const response = await request(httpServerOf(app)).get("/healthz").expect(503);
  expect(bodyOf(response)).toEqual({
    error: { code: "internal_error", message: "database unavailable" },
  });
  await app.close();
});

it("upgrades the original migration without replacing legacy users, tokens, or sessions", async () => {
  const sessionToken = createToken();

  const upgrade = upgradeFrom("0000_steep_trish_tilby", (old) => {
    seedLegacySession(old, sessionToken);
  });

  const next = await createTestApp({
    config: {
      database: upgrade.headConfig.database,
      auth: {
        mode: "oidc",
        providers: [LEGACY_TEST_PROVIDER],
        allowLoopbackHttp: false,
        tombstoneHmacKey: "0".repeat(64),
      },
    },
  });

  try {
    const upgradedClient = getDatabase(next.app).$client;
    expectHead({ $client: upgradedClient });
    expect(upgradedClient.prepare("SELECT id FROM users").all()).toEqual([{ id: "legacy-user" }]);
    expect(upgradedClient.prepare("SELECT * FROM login_tokens").all()).toHaveLength(1);
    await request(httpServerOf(next.app))
      .get("/v1/me")
      .set("Authorization", `Bearer ${sessionToken}`)
      .expect(200);
  } finally {
    await next.app.close();
  }
});
