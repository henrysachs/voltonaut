import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { testServerConfig } from "../config.js";
import { createDatabase } from "./drizzle.provider.js";
import type { DatabaseReader } from "../testing/test-app.spec.js";

const LEGACY_STRAVA_COLUMNS = [
  "user_id",
  "athlete_id",
  "status",
  "encrypted_tokens",
  "access_expires_at",
  "scope",
  "revoke_lease_until",
  "handoff_hash",
  "binding_hash",
  "confirm_by",
  "generation",
  "token_revision",
  "credential_state",
  "work_owner",
  "work_kind",
  "work_until",
];

function legacyFolder(directory: string): string {
  const source = resolve("apps/server/drizzle");
  const folder = join(directory, "legacy");

  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const entries = journal.entries.slice(0, 6);
  expect(entries).toHaveLength(6);
  mkdirSync(join(folder, "meta"), { recursive: true });

  for (const entry of entries)
    copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return folder;
}

function oldData(db: DatabaseReader) {
  return [
    db.$client.prepare("SELECT id, email, created_at, deleted_at FROM users").all(),
    db.$client.prepare("SELECT * FROM auth_identities").all(),
    db.$client.prepare("SELECT * FROM sessions").all(),
    db.$client.prepare("SELECT * FROM profiles").all(),
    db.$client.prepare("SELECT * FROM rides").all(),
    db.$client.prepare(`SELECT ${LEGACY_STRAVA_COLUMNS.join(",")} FROM strava_connections`).all(),
  ];
}

function seed(db: {
  readonly $client: {
    readonly exec: ReturnType<typeof createDatabase>["$client"]["exec"];
    readonly pragma: ReturnType<typeof createDatabase>["$client"]["pragma"];
  };
}): void {
  db.$client.exec(`
    INSERT INTO users (id, email, created_at, deleted_at) VALUES ('existing', 'existing@example.com', 123, NULL);
    INSERT INTO users (id, email, created_at, deleted_at) VALUES ('first', 'first@example.com', 124, NULL);
    INSERT INTO users (id, email, created_at, deleted_at) VALUES ('second', 'second@example.com', 125, NULL);
    INSERT INTO auth_identities VALUES ('https://issuer.example', 'opaque-subject', 'existing');
    INSERT INTO sessions VALUES ('unchanged-session-hash', 'existing', 123, 123, 9999999999999, 'agent');
    INSERT INTO profiles VALUES ('existing', '{"untouched":"profile"}', 123);
    INSERT INTO rides (id,user_id,payload_json,payload_hash,receipt_json,assessment_json,started_at,uploaded_at,duration_ms,distance_m,source)
      VALUES ('old-ride','existing','raw-payload','raw-hash','raw-receipt','raw-assessment','2026-11-20T00:00:00.000Z',123,1000,1,'ble');
    INSERT INTO strava_connections (user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation)
      VALUES ('existing','123','connected','unchanged-ciphertext',9999999999999,'activity:write','generation');
  `);

  const columns = z
    .array(z.object({ name: z.string() }))
    .parse(db.$client.pragma("table_info(strava_connections)"));

  expect(columns.map((column) => column.name)).toEqual(LEGACY_STRAVA_COLUMNS);
}

it("adds membership and authorization revisions after six actual migrations without changing opaque owners or prior bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-membership-upgrade-"));
  const path = join(directory, "accounts.db");

  try {
    const old = createDatabase(
      testServerConfig({ database: { path, migrationsDir: legacyFolder(directory) } }),
    );

    seed(old);

    const before = oldData(old);
    expect(old.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(6);
    old.$client.close();
    const config = testServerConfig({ database: { path, migrationsDir: "drizzle" } });
    const next = createDatabase(config);
    expect(oldData(next)).toEqual(before);

    const revisions = next.$client
      .prepare(
        "SELECT authorization_hint_revision,authorization_checked_revision,authorization_check_after FROM strava_connections",
      )
      .get();

    expect(revisions).toEqual({
      authorization_hint_revision: 0,
      authorization_checked_revision: 0,
      authorization_check_after: 0,
    });
    expect(next.$client.prepare("SELECT * FROM account_status").all()).toEqual([]);
    next.$client.prepare("INSERT INTO account_status (user_id) VALUES ('existing')").run();
    expect(next.$client.prepare("SELECT * FROM account_status").all()).toEqual([
      { user_id: "existing", tier: "normal", vip: 0, role: "user" },
    ]);
    expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(next.$client.prepare("PRAGMA foreign_key_list(account_status)").all()).toMatchObject([
      { table: "users", from: "user_id", to: "id" },
    ]);
    next.$client.close();
    const restarted = createDatabase(config);
    expect(oldData(restarted)).toEqual(before);
    expect(restarted.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(10);
    restarted.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("enforces FK, NOT NULL and each membership/role CHECK in SQLite itself", () => {
  const db = createDatabase(testServerConfig());

  try {
    db.$client
      .prepare(
        "INSERT INTO users (id, email, created_at, deleted_at) VALUES ('existing','existing@example.com',0,NULL)",
      )
      .run();

    const insert = db.$client.prepare(
      "INSERT INTO account_status (user_id,tier,vip,role) VALUES (?,?,?,?)",
    );

    for (const tier of ["normal", "premium", "pro"]) {
      for (const vip of [0, 1]) {
        insert.run("existing", tier, vip, "user");
        expect(db.$client.prepare("SELECT tier,vip,role FROM account_status").get()).toEqual({
          tier,
          vip,
          role: "user",
        });
        db.$client.prepare("DELETE FROM account_status").run();
      }
    }

    for (const row of [
      ["existing", "vip", 0, "user"],
      ["existing", "pro", 2, "user"],
      ["existing", "pro", 0, "owner"],
    ])
      expect(() => insert.run(...row)).toThrow("CHECK");
    expect(() => insert.run("missing", "normal", 0, "user")).toThrow("FOREIGN KEY");
    expect(() => insert.run("existing", null, 0, "user")).toThrow("NOT NULL");
  } finally {
    db.$client.close();
  }
});
