import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import type { DatabaseReader } from "../testing/test-app.spec.js";

function assertOwnedForeignKeys(db: DatabaseReader): void {
  expect(db.$client.prepare("PRAGMA foreign_key_list(profiles)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id", on_delete: "NO ACTION" },
  ]);
  expect(db.$client.prepare("PRAGMA foreign_key_list(rides)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id", on_delete: "NO ACTION" },
  ]);
  expect(() => db.$client.prepare("INSERT INTO profiles VALUES ('orphan', '{}', 0)").run()).toThrow(
    "FOREIGN KEY",
  );
  expect(() =>
    db.$client
      .prepare(
        "INSERT INTO rides (id, user_id, payload_json, payload_hash, receipt_json, assessment_json, started_at, uploaded_at, duration_ms, distance_m, source) VALUES ('orphan', 'orphan', '{}', 'hash', '{}', '{}', '2026-11-20T00:00:00.000Z', 0, 1000, 0, 'sim')",
      )
      .run(),
  ).toThrow("FOREIGN KEY");
}

it("enforces both owner foreign keys on a fresh database", async () => {
  expect.assertions(4);
  const { app } = await createTestApp();

  try {
    assertOwnedForeignKeys(getDatabase(app));
  } finally {
    await app.close();
  }
});

function priorMigrations(directory: string, migrationCount: number): string {
  const source = resolve("apps/server/drizzle");
  const legacy = join(directory, "legacy");

  const journal = z
    .object({
      entries: z.array(z.object({ tag: z.string() }).passthrough()),
    })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const entries = journal.entries.slice(0, migrationCount);

  if (entries.length !== migrationCount) {
    throw new Error("missing prior migrations");
  }

  mkdirSync(join(legacy, "meta"), { recursive: true });

  for (const entry of entries) {
    copyFileSync(join(source, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  }

  writeFileSync(join(legacy, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return legacy;
}

function readAuthState(client: DatabaseReader["$client"], migrationCount: number) {
  return {
    users: client.prepare("SELECT id, email, created_at, deleted_at FROM users").all(),
    sessions: client.prepare("SELECT * FROM sessions").all(),
    identities: migrationCount === 2 ? client.prepare("SELECT * FROM auth_identities").all() : [],
    handoffs: migrationCount === 2 ? client.prepare("SELECT * FROM oidc_handoffs").all() : [],
    transactions:
      migrationCount === 2 ? client.prepare("SELECT * FROM oidc_transactions").all() : [],
  };
}

function createExistingDatabase(directory: string, migrationCount: number) {
  const legacy = priorMigrations(directory, migrationCount);
  const path = join(directory, "existing.db");
  const client = new Database(path);

  try {
    client.pragma("foreign_keys = ON");
    migrate(drizzle(client), { migrationsFolder: legacy });
    client
      .prepare(
        "INSERT INTO users (id, email, created_at, deleted_at) VALUES ('legacy-user', 'legacy@example.com', 123, NULL)",
      )
      .run();
    client
      .prepare(
        "INSERT INTO sessions VALUES ('legacy-hash', 'legacy-user', 123, 123, 9999999999999, NULL)",
      )
      .run();

    if (migrationCount === 2) {
      client
        .prepare(
          "INSERT INTO auth_identities VALUES ('https://identity.example', 'subject', 'legacy-user')",
        )
        .run();
      client
        .prepare(
          "INSERT INTO oidc_handoffs VALUES ('code-hash', 'binding-hash', 'legacy-user', 9999999999999)",
        )
        .run();
      client
        .prepare(
          "INSERT INTO oidc_transactions VALUES ('state-hash', 'binding-hash', 'nonce', 'verifier', 9999999999999, 123)",
        )
        .run();
    }

    return { path, authState: readAuthState(client, migrationCount) };
  } finally {
    client.close();
  }
}

it.each([1, 2])(
  "upgrades %i prior migrations without losing auth data and adds both owner foreign keys",
  async (migrationCount) => {
    const directory = mkdtempSync(join(tmpdir(), "voltonaut-owned-upgrade-"));

    try {
      const { path, authState } = createExistingDatabase(directory, migrationCount);

      const { app } = await createTestApp({
        config: { database: { path, migrationsDir: "drizzle" } },
      });

      try {
        const db = getDatabase(app);

        // Migration 0008 only adds nullable/defaulted columns; legacy rows keep every prior value.
        expect(readAuthState(db.$client, migrationCount)).toEqual({
          ...authState,
          transactions: authState.transactions.map((row) =>
            Object.assign(z.object({}).passthrough().parse(row), {
              provider: "",
              link_user_id: null,
              link_session_hash: null,
            }),
          ),
          handoffs: authState.handoffs.map((row) =>
            Object.assign(z.object({}).passthrough().parse(row), {
              link_issuer: null,
              link_subject: null,
              link_session_hash: null,
            }),
          ),
        });
        expect(db.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(14);
        assertOwnedForeignKeys(db);
      } finally {
        await app.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
