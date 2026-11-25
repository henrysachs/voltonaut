import { expect, it } from "vitest";
import { seedOwners, upgradeFrom, type SeedDatabase } from "../testing/migration-harness.spec.js";

function legacyAuth(db: SeedDatabase) {
  seedOwners(db, [{ id: "existing", email: "existing@example.com", createdAt: 123 }]);
  db.$client.exec(
    "INSERT INTO sessions (token_hash,user_id,created_at,last_seen_at,expires_at,user_agent) VALUES ('existing-session', 'existing', 123, 123, 9999999999999, NULL)",
  );

  return {
    users: db.$client.prepare("SELECT id, email, created_at, deleted_at FROM users").all(),
    sessions: db.$client.prepare("SELECT * FROM sessions").all(),
  };
}

it.each(["0000_steep_trish_tilby", "0001_material_red_shift", "0002_owned_profiles_rides"])(
  "preserves data from a database at %s, enforces Strava owner FKs and reopens",
  (tag) => {
    const upgrade = upgradeFrom(tag, legacyAuth);
    const auth = upgrade.seeded;
    const db = upgrade.open();
    expect(db.$client.prepare("SELECT id, email, created_at, deleted_at FROM users").all()).toEqual(
      auth.users,
    );
    expect(db.$client.prepare("SELECT * FROM sessions").all()).toEqual(auth.sessions);
    expect(db.$client.prepare("PRAGMA foreign_key_list(strava_connections)").all()).toMatchObject([
      { table: "users", from: "user_id", to: "id" },
    ]);
    expect(db.$client.prepare("PRAGMA foreign_key_list(strava_transactions)").all()).toMatchObject([
      { table: "users", from: "user_id", to: "id" },
    ]);
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
    const reopened = upgrade.open();
    expect(
      reopened.$client.prepare("SELECT encrypted_tokens FROM strava_connections").get(),
    ).toEqual({ encrypted_tokens: "encrypted-only" });
    expect(reopened.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  },
);

it("keeps existing profiles and rides byte-identical across the additive migration", () => {
  const upgrade = upgradeFrom("0002_owned_profiles_rides", (old) => {
    seedOwners(old, [{ id: "existing", email: "existing@example.com", createdAt: 123 }]);
    old.$client.exec(`
      INSERT INTO profiles (user_id,profile_json,updated_at) VALUES ('existing', '{"displayName":"unchanged"}', 123);
      INSERT INTO rides (id,user_id,payload_json,payload_hash,receipt_json,assessment_json,started_at,uploaded_at,duration_ms,distance_m,source)
        VALUES ('legacy-ride', 'existing', '{}', 'hash', '{}', '{}', '2026-11-20T00:00:00.000Z', 0, 1000, 0, 'sim');
    `);

    return {
      profiles: old.$client.prepare("SELECT * FROM profiles").all(),
      rides: old.$client.prepare("SELECT * FROM rides").all(),
    };
  });

  const before = upgrade.seeded;
  const db = upgrade.open();
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
});
