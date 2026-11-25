import { expect, it } from "vitest";
import { decryptTokens, encryptTokens } from "../strava/strava.crypto.js";
import { seedOwners, upgradeFrom } from "../testing/migration-harness.spec.js";

const REVISION_QUERY =
  "SELECT encrypted_tokens,authorization_hint_revision,authorization_checked_revision,authorization_check_after FROM strava_connections";

const BEFORE_MEMBERSHIP = "0005_strava_delivery";
const WITH_MEMBERSHIP = "0006_account_membership_admin";

function existingDatabase(tag: string) {
  const key = "a".repeat(64);
  const tokens = { accessToken: "old-access-token", refreshToken: "old-refresh-token" };
  const encrypted = encryptTokens(tokens, key, "owner", "42");

  const upgrade = upgradeFrom(tag, (old) => {
    seedOwners(old, [{ id: "owner", email: "owner@example.test", createdAt: 123 }]);
    old.$client.exec(
      "INSERT INTO sessions (token_hash,user_id,created_at,last_seen_at,expires_at,user_agent) VALUES ('existing-session','owner',1,2,999999,'original-agent')",
    );
    old.$client.exec(
      "INSERT INTO rides(id,user_id,payload_json,payload_hash,receipt_json,assessment_json,started_at,uploaded_at,duration_ms,distance_m,source,export_tcx,export_hash,export_version) VALUES ('owned-ride','owner','{\"original\": true}','payload-hash','{\"receipt\":1}','{\"status\":\"unverified\"}','2026-11-20T00:00:00Z',1,1000,1.25,'ble','<original/>','export-hash','tcx-1')",
    );
    old.$client
      .prepare(
        "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope,generation,token_revision) VALUES ('owner','42','connected',?,999999,'activity:write','existing-generation',3)",
      )
      .run(encrypted);

    if (tag === WITH_MEMBERSHIP)
      old.$client.exec(
        "INSERT INTO account_status (user_id,tier,vip,role) VALUES ('owner','pro',1,'admin')",
      );

    return {
      membership:
        tag === WITH_MEMBERSHIP ? old.$client.prepare("SELECT * FROM account_status").all() : [],
      sessions: old.$client.prepare("SELECT * FROM sessions").all(),
      rides: old.$client.prepare("SELECT * FROM rides").all(),
      ciphers: old.$client
        .prepare("SELECT encrypted_tokens,generation,token_revision FROM strava_connections")
        .all(),
    };
  });

  return { upgrade, key, tokens, encrypted, before: upgrade.seeded };
}

it.each([BEFORE_MEMBERSHIP, WITH_MEMBERSHIP])(
  "adds authorization revisions to a database at %s without rewriting membership, ciphers, sessions or owned rides",
  (tag) => {
    const { upgrade, key, tokens, encrypted, before } = existingDatabase(tag);
    const upgraded = upgrade.open();
    expect(upgraded.$client.prepare("SELECT * FROM account_status").all()).toEqual(
      before.membership,
    );
    expect(upgraded.$client.prepare("SELECT * FROM sessions").all()).toEqual(before.sessions);
    expect(upgraded.$client.prepare("SELECT * FROM rides").all()).toEqual(before.rides);
    expect(
      upgraded.$client
        .prepare("SELECT encrypted_tokens,generation,token_revision FROM strava_connections")
        .all(),
    ).toEqual(before.ciphers);
    expect(decryptTokens(encrypted, key, "owner", "42")).toEqual(tokens);
    expect(upgraded.$client.prepare(REVISION_QUERY).get()).toEqual({
      encrypted_tokens: encrypted,
      authorization_hint_revision: 0,
      authorization_checked_revision: 0,
      authorization_check_after: 0,
    });
    expect(upgraded.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(upgraded.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(upgraded.$client.pragma("foreign_key_check")).toEqual([]);
    upgraded.$client.exec(
      "UPDATE strava_connections SET authorization_hint_revision=2,authorization_checked_revision=1,authorization_check_after=60000",
    );
    upgraded.$client.close();
    const reopened = upgrade.open();
    expect(reopened.$client.prepare("SELECT * FROM account_status").all()).toEqual(
      before.membership,
    );
    expect(reopened.$client.prepare(REVISION_QUERY).get()).toEqual({
      encrypted_tokens: encrypted,
      authorization_hint_revision: 2,
      authorization_checked_revision: 1,
      authorization_check_after: 60000,
    });
  },
);
