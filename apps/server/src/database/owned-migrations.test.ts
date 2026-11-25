import { expect, it } from "vitest";
import { z } from "zod";

import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import type { DatabaseReader } from "../testing/test-app.spec.js";
import {
  expectHead,
  seedOwners,
  upgradeFrom,
  type SeedDatabase,
} from "../testing/migration-harness.spec.js";

function assertOwnedForeignKeys(db: DatabaseReader): void {
  expect(db.$client.prepare("PRAGMA foreign_key_list(profiles)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id", on_delete: "NO ACTION" },
  ]);
  expect(db.$client.prepare("PRAGMA foreign_key_list(rides)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id", on_delete: "NO ACTION" },
  ]);
  expect(() =>
    db.$client
      .prepare("INSERT INTO profiles (user_id,profile_json,updated_at) VALUES ('orphan', '{}', 0)")
      .run(),
  ).toThrow("FOREIGN KEY");
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

const BEFORE_OIDC = "0000_steep_trish_tilby";
const WITH_OIDC = "0001_material_red_shift";

function readAuthState(client: DatabaseReader["$client"], tag: string) {
  return {
    users: client.prepare("SELECT id, email, created_at, deleted_at FROM users").all(),
    sessions: client.prepare("SELECT * FROM sessions").all(),
    identities: tag === WITH_OIDC ? client.prepare("SELECT * FROM auth_identities").all() : [],
    handoffs: tag === WITH_OIDC ? client.prepare("SELECT * FROM oidc_handoffs").all() : [],
    transactions: tag === WITH_OIDC ? client.prepare("SELECT * FROM oidc_transactions").all() : [],
  };
}

function seedAuth(client: SeedDatabase["$client"], tag: string) {
  seedOwners({ $client: client }, [
    { id: "legacy-user", email: "legacy@example.com", createdAt: 123 },
  ]);
  client.exec(
    "INSERT INTO sessions (token_hash,user_id,created_at,last_seen_at,expires_at,user_agent) VALUES ('legacy-hash', 'legacy-user', 123, 123, 9999999999999, NULL)",
  );

  if (tag === WITH_OIDC)
    client.exec(`
      INSERT INTO auth_identities (issuer,subject,user_id) VALUES ('https://identity.example', 'subject', 'legacy-user');
      INSERT INTO oidc_handoffs (code_hash,binding_hash,user_id,expires_at) VALUES ('code-hash', 'binding-hash', 'legacy-user', 9999999999999);
      INSERT INTO oidc_transactions (state_hash,binding_hash,nonce,verifier,expires_at,claimed_at)
        VALUES ('state-hash', 'binding-hash', 'nonce', 'verifier', 9999999999999, 123);
    `);

  return readAuthState(client, tag);
}

it.each([BEFORE_OIDC, WITH_OIDC])(
  "upgrades a database at %s without losing auth data and adds both owner foreign keys",
  async (tag) => {
    const upgrade = upgradeFrom(tag, (old) => seedAuth(old.$client, tag));
    const authState = upgrade.seeded;
    const { app } = await createTestApp({ config: upgrade.headConfig });

    try {
      const db = getDatabase(app);

      // Migration 0008 only adds nullable/defaulted columns; legacy rows keep every prior value.
      expect(readAuthState(db.$client, tag)).toEqual({
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
      expectHead(db);
      assertOwnedForeignKeys(db);
    } finally {
      await app.close();
    }
  },
);
