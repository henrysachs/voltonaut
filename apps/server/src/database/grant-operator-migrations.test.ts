import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { testServerConfig } from "../config.js";
import { createDatabase } from "./drizzle.provider.js";

/** The thirteen migrations before the operator audit of issue #116, ending with 0012. */
function beforeOperatorAudit(directory: string): string {
  const source = resolve("apps/server/drizzle");
  const folder = join(directory, "before-operator-audit");

  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const entries = journal.entries.slice(0, 13);

  expect(entries.at(-1)?.tag).toBe("0012_progress_consent_journals");
  mkdirSync(join(folder, "meta"), { recursive: true });

  for (const entry of entries)
    copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return folder;
}

const SEED = `
  INSERT INTO users (id,email,created_at) VALUES ('owner', 'owner@example.com', 1);
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
    VALUES ('a-grant','owner',7000,'operator_grant','acceptance','operator:acceptance','hash-a',3);
  INSERT INTO volts_ledger (id,user_id,delta_volts,reason,ref_id,idempotency_key,payload_hash,created_at)
    VALUES ('b-buy','owner',-1500,'purchase','jersey.stripe','purchase:r','hash-b',4);
`;

const LEDGER_ROWS = "SELECT * FROM volts_ledger ORDER BY id";

it("marks existing grants as operator unknown before the audit instead of inventing one", () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-operator-audit-"));
  const path = join(directory, "audit.db");

  try {
    const old = createDatabase(
      testServerConfig({ database: { path, migrationsDir: beforeOperatorAudit(directory) } }),
    );

    old.$client.exec(SEED);

    const before = old.$client.prepare(LEDGER_ROWS).all();

    old.$client.close();

    const next = createDatabase(testServerConfig({ database: { path, migrationsDir: "drizzle" } }));

    expect(next.$client.prepare(LEDGER_ROWS).all()).toEqual(before);
    expect(next.$client.prepare("SELECT * FROM volts_grant_operators").all()).toEqual([
      {
        entry_id: "a-grant",
        operator_user_id: null,
        provenance: "unknown_before_audit",
        recorded_at: 3,
      },
    ]);
    expect(next.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    next.$client.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
