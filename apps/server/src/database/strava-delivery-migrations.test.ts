import { expect, it } from "vitest";
import { z } from "zod";
import { BEFORE_STRAVA_DELIVERY, seedLegacyStrava } from "./strava-migrations.spec.js";
import { decryptTokens } from "../strava/strava.crypto.js";
import { upgradeFrom } from "../testing/migration-harness.spec.js";

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
  const key = "a".repeat(64);
  const tokens = { accessToken: "existing-access-token", refreshToken: "existing-refresh-token" };

  const upgrade = upgradeFrom(BEFORE_STRAVA_DELIVERY, (old) => seedLegacyStrava(old, key, tokens));

  const upgraded = upgrade.open();
  expect(
    upgraded.$client
      .prepare(
        "SELECT user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,revoke_lease_until,handoff_hash,binding_hash,confirm_by FROM strava_connections ORDER BY user_id",
      )
      .all(),
  ).toEqual(upgrade.seeded);

  const rows = UpgradedConnectionsSchema.parse(
    upgraded.$client.prepare("SELECT * FROM strava_connections ORDER BY user_id").all(),
  );

  expect(new Set(rows.map((row) => row.generation)).size).toBe(2);

  for (const row of rows)
    expect(decryptTokens(row.encrypted_tokens, key, row.user_id, row.athlete_id)).toEqual(tokens);

  const state = upgraded.$client.prepare("SELECT * FROM strava_connections ORDER BY user_id").all();

  expect(upgraded.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  upgraded.$client.close();
  expect(
    upgrade.open().$client.prepare("SELECT * FROM strava_connections ORDER BY user_id").all(),
  ).toEqual(state);
});
