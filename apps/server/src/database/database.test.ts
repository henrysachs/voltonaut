import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import type { OidcProviderConfig } from "../oidc-config.js";
import { expect, it } from "vitest";
import { z } from "zod";

import {
  createTestApp,
  getDatabase,
  httpServerOf,
  bodyOf,
  loginTestUser,
  bearer,
} from "../testing/test-app.spec.js";
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
      "login_tokens",
      "oidc_handoffs",
      "oidc_transactions",
      "profiles",
      "rides",
      "sessions",
      "strava_connections",
      "strava_deliveries",
      "strava_rate_budget",
      "strava_transactions",
      "users",
      "volts_ledger",
    ].map((name) => ({ name })),
  );
  expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(() =>
    db.$client.prepare("INSERT INTO sessions VALUES ('hash', 'missing', 0, 0, 100, NULL)").run(),
  ).toThrow("FOREIGN KEY");
  await app.close();
  expect(db.$client.open).toBe(false);
});

it("persists with WAL, creates the data directory and applies migrations idempotently", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-auth-db-"));

  const config = {
    database: { path: join(directory, "data", "auth.db"), migrationsDir: "drizzle" },
  };

  try {
    const first = await createTestApp({ config });
    const db = getDatabase(first.app);
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    const migrations = db.$client.prepare("SELECT * FROM __drizzle_migrations").all();
    expect(migrations).toHaveLength(10);
    db.$client
      .prepare("INSERT INTO users VALUES ('persisted', 'persist@example.com', 0, NULL)")
      .run();
    await first.app.close();
    const second = await createTestApp({ config });
    expect(getDatabase(second.app).$client.prepare("SELECT id FROM users").all()).toEqual([
      { id: "persisted" },
    ]);
    expect(
      getDatabase(second.app).$client.prepare("SELECT * FROM __drizzle_migrations").all(),
    ).toEqual(migrations);
    await second.app.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

function legacyMigrations(directory: string): string {
  const folder = join(directory, "legacy-migrations");
  mkdirSync(join(folder, "meta"), { recursive: true });
  const source = new URL("../../drizzle/", import.meta.url);

  const journal = z
    .object({
      version: z.string(),
      dialect: z.string(),
      entries: z.array(
        z.object({
          idx: z.number(),
          version: z.string(),
          when: z.number(),
          tag: z.string(),
          breakpoints: z.boolean(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(new URL("meta/_journal.json", source), "utf8")));

  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
  );
  copyFileSync(
    new URL("0000_steep_trish_tilby.sql", source),
    join(folder, "0000_steep_trish_tilby.sql"),
  );

  return folder;
}

const LEGACY_TEST_PROVIDER: OidcProviderConfig = {
  id: "test",
  displayName: "Test",
  issuer: "https://identity.example",
  clientId: "test",
  clientSecret: "test-secret",
  redirectUri: "https://api.example/v1/auth/oidc/test/callback",
  scopes: ["openid", "email"],
  requireEmailVerified: true,
  idTokenAlg: "RS256",
};

it("upgrades the original migration without replacing legacy users, tokens, or sessions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-oidc-upgrade-"));
  const path = join(directory, "legacy.db");

  try {
    const first = await createTestApp({
      config: { database: { path, migrationsDir: legacyMigrations(directory) } },
    });

    const session = await loginTestUser(first.app, first.mail, "legacy@example.com");
    expect(
      getDatabase(first.app).$client.prepare("SELECT * FROM __drizzle_migrations").all(),
    ).toHaveLength(1);
    await first.app.close();

    const next = await createTestApp({
      config: {
        database: { path, migrationsDir: "drizzle" },
        auth: {
          mode: "oidc",
          providers: [LEGACY_TEST_PROVIDER],
          allowLoopbackHttp: false,
        },
      },
    });

    try {
      const db = getDatabase(next.app).$client;
      expect(db.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(10);
      expect(db.prepare("SELECT id FROM users").all()).toEqual([{ id: session.user.id }]);
      expect(db.prepare("SELECT * FROM login_tokens").all()).toHaveLength(1);
      await request(httpServerOf(next.app))
        .get("/v1/me")
        .set(bearer(session.sessionToken))
        .expect(200);
    } finally {
      await next.app.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
