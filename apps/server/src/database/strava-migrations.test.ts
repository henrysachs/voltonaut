import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDatabase } from "./drizzle.provider.js";
import { testServerConfig } from "../config.js";
import { legacyFolder } from "./strava-migrations.spec.js";

function legacyAuth(client: Readonly<Database.Database>) {
  client.exec(
    "INSERT INTO users VALUES ('existing', 'existing@example.com', 123, NULL); INSERT INTO sessions VALUES ('existing-session', 'existing', 123, 123, 9999999999999, NULL)",
  );

  return {
    users: client.prepare("SELECT * FROM users").all(),
    sessions: client.prepare("SELECT * FROM sessions").all(),
  };
}

it.each([1, 2, 3])(
  "preserves data from %i existing migrations, enforces Strava owner FKs and reopens",
  (count) => {
    const directory = mkdtempSync(join(tmpdir(), "voltonaut-strava-upgrade-"));
    const path = join(directory, "existing.db");

    try {
      const client = new Database(path);
      migrate(drizzle(client), { migrationsFolder: legacyFolder(directory, count) });
      const auth = legacyAuth(client);

      client.close();
      const config = testServerConfig({ database: { path, migrationsDir: "drizzle" } });
      const db = createDatabase(config);
      expect(db.$client.prepare("SELECT * FROM users").all()).toEqual(auth.users);
      expect(db.$client.prepare("SELECT * FROM sessions").all()).toEqual(auth.sessions);
      expect(db.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(9);
      expect(db.$client.prepare("PRAGMA foreign_key_list(strava_connections)").all()).toMatchObject(
        [{ table: "users", from: "user_id", to: "id" }],
      );
      expect(
        db.$client.prepare("PRAGMA foreign_key_list(strava_transactions)").all(),
      ).toMatchObject([{ table: "users", from: "user_id", to: "id" }]);
      expect(() =>
        db.$client
          .prepare(
            "INSERT INTO strava_transactions(state_hash,user_id,binding_hash,expires_at,claimed_at) VALUES ('hash', 'orphan', 'binding', 1, NULL)",
          )
          .run(),
      ).toThrow("FOREIGN KEY");
      db.$client
        .prepare(
          "INSERT INTO strava_connections(user_id, athlete_id, status, encrypted_tokens, access_expires_at, scope) VALUES ('existing', '42', 'connected', 'encrypted-only', 123, 'activity:write')",
        )
        .run();
      db.$client.close();
      const reopened = createDatabase(config);
      expect(
        reopened.$client.prepare("SELECT encrypted_tokens FROM strava_connections").get(),
      ).toEqual({ encrypted_tokens: "encrypted-only" });
      expect(reopened.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      reopened.$client.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("keeps existing profiles and rides byte-identical across the additive migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-strava-owned-"));
  const path = join(directory, "existing.db");

  try {
    const client = new Database(path);
    migrate(drizzle(client), { migrationsFolder: legacyFolder(directory, 3) });
    client.exec(
      "INSERT INTO users VALUES ('existing', 'existing@example.com', 123, NULL); INSERT INTO profiles VALUES ('existing', '{\"displayName\":\"unchanged\"}', 123); INSERT INTO rides VALUES ('legacy-ride', 'existing', '{}', 'hash', '{}', '{}', '2026-11-20T00:00:00.000Z', 0, 1000, 0, 'sim')",
    );

    const before = {
      profiles: client.prepare("SELECT * FROM profiles").all(),
      rides: client.prepare("SELECT * FROM rides").all(),
    };

    client.close();
    const db = createDatabase(testServerConfig({ database: { path, migrationsDir: "drizzle" } }));
    expect(db.$client.prepare("SELECT * FROM profiles").all()).toEqual(before.profiles);
    expect(
      db.$client
        .prepare(
          "SELECT id, user_id, payload_json, payload_hash, receipt_json, assessment_json, started_at, uploaded_at, duration_ms, distance_m, source FROM rides",
        )
        .all(),
    ).toEqual(before.rides);
    expect(
      db.$client
        .prepare("SELECT summary_json, export_tcx, export_hash, export_version FROM rides")
        .all(),
    ).toEqual([{ summary_json: null, export_tcx: null, export_hash: null, export_version: null }]);
    db.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
