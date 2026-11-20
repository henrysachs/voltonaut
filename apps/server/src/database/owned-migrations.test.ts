import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

import { createTestApp, getDatabase } from "../testing/test-app.spec.js";
import type { DatabaseReader } from "../testing/test-app.spec.js";

function assertOwnedForeignKeys(db: DatabaseReader): void {
  expect(db.$client.prepare("PRAGMA foreign_key_list(profiles)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id", on_delete: "NO ACTION" },
  ]);
  expect(db.$client.prepare("PRAGMA foreign_key_list(rides)").all()).toMatchObject([
    { table: "users", from: "user_id", to: "id", on_delete: "NO ACTION" },
  ]);
  expect(() => db.$client.prepare("INSERT INTO profiles VALUES ('orphan', '{}', 0)").run()).toThrow(
    "FOREIGN KEY",
  );
  expect(() =>
    db.$client
      .prepare(
        "INSERT INTO rides VALUES ('orphan', 'orphan', '{}', 'hash', '{}', '{}', '2026-11-20T00:00:00.000Z', 0, 1000, 0, 'sim')",
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

function createExistingDatabase(directory: string): string {
  const source = resolve("apps/server/drizzle");
  const legacy = join(directory, "legacy");

  const journal = z
    .object({
      entries: z.array(z.object({ tag: z.string() }).passthrough()),
    })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const first = journal.entries[0];

  if (first === undefined) {
    throw new Error("missing baseline migration");
  }

  mkdirSync(join(legacy, "meta"), { recursive: true });
  copyFileSync(join(source, `${first.tag}.sql`), join(legacy, `${first.tag}.sql`));
  writeFileSync(
    join(legacy, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: [first] }),
  );
  const path = join(directory, "existing.db");
  const client = new Database(path);

  try {
    client.pragma("foreign_keys = ON");
    migrate(drizzle(client), { migrationsFolder: legacy });
    client
      .prepare("INSERT INTO users VALUES ('legacy-user', 'legacy@example.com', 123, NULL)")
      .run();
    client
      .prepare(
        "INSERT INTO sessions VALUES ('legacy-hash', 'legacy-user', 123, 123, 9999999999999, NULL)",
      )
      .run();
  } finally {
    client.close();
  }

  return path;
}

it("upgrades actual 0000 without losing users or sessions and adds both owner foreign keys", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voltonaut-owned-upgrade-"));

  try {
    const path = createExistingDatabase(directory);

    const { app } = await createTestApp({
      config: { database: { path, migrationsDir: "drizzle" } },
    });

    try {
      const db = getDatabase(app);

      expect(db.$client.prepare("SELECT * FROM users").all()).toEqual([
        { id: "legacy-user", email: "legacy@example.com", created_at: 123, deleted_at: null },
      ]);
      expect(db.$client.prepare("SELECT token_hash, user_id FROM sessions").all()).toEqual([
        { token_hash: "legacy-hash", user_id: "legacy-user" },
      ]);
      expect(db.$client.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(2);
      assertOwnedForeignKeys(db);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
