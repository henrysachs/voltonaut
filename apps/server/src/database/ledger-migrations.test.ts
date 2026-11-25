import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { testServerConfig } from "../config.js";
import { createDatabase } from "./drizzle.provider.js";

/** The eleven migrations before E7-02, ending with the account-deletion guards of 0010. */
function beforeInventory(directory: string): string {
  const source = resolve("apps/server/drizzle");
  const folder = join(directory, "before-inventory");

  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const entries = journal.entries.slice(0, 11);

  expect(entries.at(-1)?.tag).toBe("0010_common_jack_flag");
  mkdirSync(join(folder, "meta"), { recursive: true });

  for (const entry of entries)
    copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return folder;
}

const LEDGER_ROWS = "SELECT * FROM volts_ledger ORDER BY id";

const GUARDS =
  "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('volts_ledger', 'inventory') ORDER BY name";

const SEED = `
  INSERT INTO users (id,email,created_at) VALUES ('owner', 'owner@example.com', 1);
  INSERT INTO users (id,email,created_at) VALUES ('gone', 'gone@example.com', 1);
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
function upgradedFromAccountDeletion(directory: string) {
  const path = join(directory, "ledger.db");

  const old = createDatabase(
    testServerConfig({ database: { path, migrationsDir: beforeInventory(directory) } }),
  );

  old.$client.exec(SEED);

  const before = old.$client.prepare(LEDGER_ROWS).all();

  old.$client.close();

  return {
    before,
    next: createDatabase(testServerConfig({ database: { path, migrationsDir: "drizzle" } })),
  };
}

it("keeps every Volts booking when the ledger learns operator grants", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-ledger-upgrade-"));

  try {
    const { before, next } = upgradedFromAccountDeletion(directory);

    expect(next.$client.prepare(LEDGER_ROWS).all()).toEqual(before);
    expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(next.$client.prepare("SELECT * FROM inventory").all()).toEqual([]);
    expect(next.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(14);
    next.$client
      .prepare(GRANT)
      .run("c-grant", "owner", 7000, "acceptance", "operator:acceptance", "hash-c", 3);
    expect(
      next.$client.prepare("SELECT SUM(delta_volts) AS balance FROM volts_ledger").get(),
    ).toEqual({ balance: 7012 });
    next.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps the account-deletion guards when the ledger is rebuilt and guards the inventory", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-ledger-guards-"));

  try {
    const { next } = upgradedFromAccountDeletion(directory);

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
    next.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
