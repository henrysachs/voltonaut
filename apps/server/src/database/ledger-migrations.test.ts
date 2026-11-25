import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { testServerConfig } from "../config.js";
import { createDatabase } from "./drizzle.provider.js";

/** The ten migrations before E7-02, ending with the original volts_ledger. */
function beforeInventory(directory: string): string {
  const source = resolve("apps/server/drizzle");
  const folder = join(directory, "before-inventory");

  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const entries = journal.entries.slice(0, 10);

  expect(entries.at(-1)?.tag).toBe("0009_volts_ledger");
  mkdirSync(join(folder, "meta"), { recursive: true });

  for (const entry of entries)
    copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return folder;
}

const LEDGER_ROWS = "SELECT * FROM volts_ledger ORDER BY id";

it("keeps every existing Volts booking when the ledger learns operator grants", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-ledger-upgrade-"));
  const path = join(directory, "ledger.db");

  try {
    const old = createDatabase(
      testServerConfig({ database: { path, migrationsDir: beforeInventory(directory) } }),
    );

    old.$client.exec(`
      INSERT INTO users VALUES ('owner', 'owner@example.com', 1, NULL);
      INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,reward_day,start_tick,end_tick,candidate_volts,cumulative_work_volts,cumulative_climb_volts,cumulative_facts_json,created_at)
        VALUES ('a-ride','owner',20,'ride_reward','journal','ride:journal:0','hash-a','2026-11-24',0,1,20,20,0,'{}',1);
      INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
        VALUES ('b-buy','owner',-8,'purchase','item','purchase:item','hash-b',2);
    `);

    const before = old.$client.prepare(LEDGER_ROWS).all();

    old.$client.close();

    const next = createDatabase(testServerConfig({ database: { path, migrationsDir: "drizzle" } }));

    expect(next.$client.prepare(LEDGER_ROWS).all()).toEqual(before);
    expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(next.$client.prepare("SELECT * FROM inventory").all()).toEqual([]);
    expect(next.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(12);
    next.$client
      .prepare(
        "INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at) VALUES ('c-grant','owner',7000,'operator_grant','acceptance','operator:acceptance','hash-c',3)",
      )
      .run();
    expect(
      next.$client.prepare("SELECT SUM(delta_volts) AS balance FROM volts_ledger").get(),
    ).toEqual({ balance: 7012 });
    next.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
