import { expect, it } from "vitest";
import { seedOwners, upgradeFrom } from "../testing/migration-harness.spec.js";

const LEDGER_ROWS = "SELECT * FROM volts_ledger ORDER BY id";

const GUARDS =
  "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('volts_ledger', 'inventory') ORDER BY name";

const SEED = `
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,reward_day,start_tick,end_tick,candidate_volts,cumulative_work_volts,cumulative_climb_volts,cumulative_facts_json,created_at)
    VALUES ('a-ride','owner',20,'ride_reward','journal','ride:journal:0','hash-a','2026-11-24',0,1,20,20,0,'{}',1);
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
    VALUES ('b-buy','owner',-8,'purchase','item','purchase:item','hash-b',2);
  UPDATE users SET deleted_at = 5 WHERE id = 'gone';
`;

const GRANT =
  "INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at) VALUES (?,?,?,'operator_grant',?,?,?,?)";

const OWNED =
  "INSERT INTO inventory (user_id,item_id,source,purchase_request_id,acquired_at) VALUES (?,'jersey.stripe','shop','r',4)";

/** A production database at 0010 (with account-deletion guards), upgraded with every migration. */
function upgradedFromAccountDeletion() {
  const upgrade = upgradeFrom("0010_common_jack_flag", (old) => {
    seedOwners(old, [
      { id: "owner", email: "owner@example.com", createdAt: 1 },
      { id: "gone", email: "gone@example.com", createdAt: 1 },
    ]);
    old.$client.exec(SEED);

    return old.$client.prepare(LEDGER_ROWS).all();
  });

  return { before: upgrade.seeded, next: upgrade.open() };
}

it("keeps every Volts booking when the ledger learns operator grants", () => {
  const { before, next } = upgradedFromAccountDeletion();

  expect(next.$client.prepare(LEDGER_ROWS).all()).toEqual(before);
  expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(next.$client.prepare("SELECT * FROM inventory").all()).toEqual([]);
  next.$client
    .prepare(GRANT)
    .run("c-grant", "owner", 7000, "acceptance", "operator:acceptance", "hash-c", 3);
  expect(
    next.$client.prepare("SELECT SUM(delta_volts) AS balance FROM volts_ledger").get(),
  ).toEqual({ balance: 7012 });
});

it("keeps the account-deletion guards when the ledger is rebuilt and guards the inventory", () => {
  const { next } = upgradedFromAccountDeletion();

  expect(next.$client.prepare(GUARDS).all()).toEqual([
    { name: "inventory_reject_deleted_owner_insert" },
    { name: "inventory_reject_deleted_owner_update" },
    { name: "volts_ledger_reject_deleted_owner_insert" },
    { name: "volts_ledger_reject_deleted_owner_update" },
  ]);
  expect(() =>
    next.$client.prepare(GRANT).run("d-grant", "gone", 5, "late", "operator:late", "hash-d", 4),
  ).toThrow("account is deleted");
  expect(() => next.$client.prepare(OWNED).run("gone")).toThrow("account is deleted");
  expect(() => next.$client.prepare(OWNED).run("owner")).not.toThrow();
});
