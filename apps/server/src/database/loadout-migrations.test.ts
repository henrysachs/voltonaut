import { expect, it } from "vitest";
import { seedOwners, upgradeFrom } from "../testing/migration-harness.spec.js";

const SEED = `
  INSERT INTO inventory (user_id,item_id,source,purchase_request_id,acquired_at)
    VALUES ('owner','jersey.stripe','shop','r-1',4);
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
    VALUES ('b-buy','owner',-1500,'purchase','jersey.stripe','purchase:r-1','hash-b',4);
`;

const SNAPSHOT = [
  "SELECT * FROM users ORDER BY id",
  "SELECT * FROM inventory ORDER BY user_id, item_id",
  "SELECT * FROM volts_ledger ORDER BY id",
] as const;

it("adds avatar loadouts without touching accounts, inventory or Volts", () => {
  const upgrade = upgradeFrom("0012_progress_consent_journals", (old) => {
    seedOwners(old, [
      { id: "owner", email: "owner@example.com", createdAt: 1 },
      { id: "gone", email: "gone@example.com", createdAt: 1, deletedAt: 5 },
    ]);
    old.$client.exec(SEED);

    return SNAPSHOT.map((query) => old.$client.prepare(query).all());
  });

  const next = upgrade.open();

  expect(SNAPSHOT.map((query) => next.$client.prepare(query).all())).toEqual(upgrade.seeded);
  expect(next.$client.prepare("SELECT * FROM avatar_loadouts").all()).toEqual([]);
  expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(() =>
    next.$client
      .prepare(
        "INSERT INTO avatar_loadouts (user_id, loadout_json, updated_at) VALUES ('gone', '{}', 1)",
      )
      .run(),
  ).toThrow("account is deleted");
});
