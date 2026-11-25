import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { createDatabase } from "./drizzle.provider.js";
import { legacyStrava } from "./strava-migrations.spec.js";
import { testServerConfig } from "../config.js";
import { decryptTokens } from "../strava/strava.crypto.js";

const UpgradedConnectionsSchema = z.array(
  z.object({
    user_id: z.string(),
    athlete_id: z.string(),
    encrypted_tokens: z.string(),
    generation: z.string().regex(/^[a-f0-9]{32}$/u),
    token_revision: z.literal(0),
    credential_state: z.literal("available"),
    work_owner: z.null(),
    work_kind: z.null(),
    work_until: z.literal(0),
  }),
);

it("upgrades existing encrypted Strava connections once without replacing their credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-strava-delivery-upgrade-"));
  const path = join(directory, "existing.db");
  const key = "a".repeat(64);
  const tokens = { accessToken: "existing-access-token", refreshToken: "existing-refresh-token" };

  try {
    const before = legacyStrava(directory, key, tokens);
    const config = testServerConfig({ database: { path, migrationsDir: "drizzle" } });
    const upgraded = createDatabase(config);
    expect(
      upgraded.$client
        .prepare(
          "SELECT user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,revoke_lease_until,handoff_hash,binding_hash,confirm_by FROM strava_connections ORDER BY user_id",
        )
        .all(),
    ).toEqual(before);

    const rows = UpgradedConnectionsSchema.parse(
      upgraded.$client.prepare("SELECT * FROM strava_connections ORDER BY user_id").all(),
    );

    expect(new Set(rows.map((row) => row.generation)).size).toBe(2);

    for (const row of rows)
      expect(decryptTokens(row.encrypted_tokens, key, row.user_id, row.athlete_id)).toEqual(tokens);

    const state = upgraded.$client
      .prepare("SELECT * FROM strava_connections ORDER BY user_id")
      .all();

    expect(upgraded.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    upgraded.$client.close();
    const reopened = createDatabase(config);
    expect(
      reopened.$client.prepare("SELECT * FROM strava_connections ORDER BY user_id").all(),
    ).toEqual(state);
    expect(reopened.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(12);
    reopened.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
