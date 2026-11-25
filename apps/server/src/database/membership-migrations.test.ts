import { expect, it } from "vitest";
import { z } from "zod";
import { testServerConfig } from "../config.js";
import { createDatabase } from "./drizzle.provider.js";
import type { DatabaseReader } from "../testing/test-app.spec.js";
import { seedOwners, upgradeFrom, type SeedDatabase } from "../testing/migration-harness.spec.js";

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

function seed(db: SeedDatabase) {
  seedOwners(db, [
    { id: "existing", email: "existing@example.com", createdAt: 123 },
    { id: "first", email: "first@example.com", createdAt: 124 },
    { id: "second", email: "second@example.com", createdAt: 125 },
  ]);
  db.$client.exec(`
    INSERT INTO auth_identities (issuer,subject,user_id) VALUES ('https://issuer.example', 'opaque-subject', 'existing');
    INSERT INTO sessions (token_hash,user_id,created_at,last_seen_at,expires_at,user_agent)
      VALUES ('unchanged-session-hash', 'existing', 123, 123, 9999999999999, 'agent');
    INSERT INTO profiles (user_id,profile_json,updated_at) VALUES ('existing', '{"untouched":"profile"}', 123);
    INSERT INTO rides (id,user_id,payload_json,payload_hash,receipt_json,assessment_json,started_at,uploaded_at,duration_ms,distance_m,source)
      VALUES ('old-ride','existing','raw-payload','raw-hash','raw-receipt','raw-assessment','2026-11-20T00:00:00.000Z',123,1000,1,'ble');
    INSERT INTO strava_connections (user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation)
      VALUES ('existing','123','connected','unchanged-ciphertext',9999999999999,'activity:write','generation');
  `);

  const columns = z
    .array(z.object({ name: z.string() }))
    .parse(db.$client.pragma("table_info(strava_connections)"));

  expect(columns.map((column) => column.name)).toEqual(LEGACY_STRAVA_COLUMNS);

  return oldData(db);
}

it("adds membership and authorization revisions after the Strava delivery migration without changing opaque owners or prior bytes", () => {
  const upgrade = upgradeFrom("0005_strava_delivery", seed);
  const before = upgrade.seeded;
  const next = upgrade.open();
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
  expect(oldData(upgrade.open())).toEqual(before);
});

it("enforces FK, NOT NULL and each membership/role CHECK in SQLite itself", () => {
  const db = createDatabase(testServerConfig());

  try {
    seedOwners(db, [{ id: "existing", email: "existing@example.com" }]);

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
