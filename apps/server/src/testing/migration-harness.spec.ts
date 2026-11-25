import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getTableName } from "drizzle-orm";
import { expect, onTestFinished } from "vitest";
import { z } from "zod";
import { testServerConfig, type ServerConfig } from "../config.js";
import { createDatabase, type ServerDatabase } from "../database/drizzle.provider.js";
import { users } from "../schema.js";
import type { DatabaseReader } from "./test-app.spec.js";

/** The committed migrations every server start applies. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../drizzle");

const JournalSchema = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z.object({
      idx: z.number(),
      version: z.string(),
      when: z.number(),
      tag: z.string(),
      breakpoints: z.boolean(),
    }),
  ),
});

type JournalEntry = z.infer<typeof JournalSchema>["entries"][number];

const JOURNAL = JournalSchema.parse(
  JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")),
);

const AppliedSchema = z.array(z.object({ created_at: z.number() }));

function entriesThrough(tag: string): readonly JournalEntry[] {
  const end = JOURNAL.entries.findIndex((entry) => entry.tag === tag);

  if (end < 0) throw new Error(`test: unknown migration tag ${tag}`);

  return JOURNAL.entries.slice(0, end + 1);
}

/** Journal timestamps from the first migration through `tag`, as Drizzle records them. */
export function migrationsThrough(tag: string): readonly number[] {
  return entriesThrough(tag).map((entry) => entry.when);
}

/** Every committed migration; derived from the journal so a new migration edits no test. */
export function headMigrations(): readonly number[] {
  return JOURNAL.entries.map((entry) => entry.when);
}

/** The migrations a database has applied, in application order. */
export function appliedMigrations(db: DatabaseReader): readonly number[] {
  return AppliedSchema.parse(
    db.$client.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY id").all(),
  ).map((row) => row.created_at);
}

/** Asserts that `db` applied exactly the committed migrations. */
export function expectHead(db: DatabaseReader): void {
  expect(appliedMigrations(db)).toEqual(headMigrations());
}

/** A fresh directory below the OS temp dir, removed recursively once the current test finishes. */
export function scratchDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `voltonaut-${prefix}-`));

  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  return directory;
}

function migrationFolder(directory: string, tag: string): string {
  const folder = join(directory, `through-${tag}`);
  const entries = entriesThrough(tag);

  mkdirSync(join(folder, "meta"), { recursive: true });

  for (const entry of entries)
    copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...JOURNAL, entries }));

  return folder;
}

/** What a seed hook may do with the old database: raw SQL only, since the schema is historic. */
export interface SeedDatabase {
  readonly $client: Readonly<Pick<ServerDatabase["$client"], "exec" | "prepare" | "pragma">>;
}

export interface UpgradeFixture<Seeded> {
  /** The SQLite file shared by the old and every upgraded connection. */
  readonly path: string;
  /** Opens `path` with every committed migration, e.g. for `createTestApp`. */
  readonly headConfig: ServerConfig;
  /** What the seed hook read or returned while the database was still at the old tag. */
  readonly seeded: Seeded;
  /** Opens `path` at head (upgrading on first call) and asserts every migration is applied. */
  readonly open: () => ServerDatabase;
}

/**
 * Creates a real file database migrated only through `tag`, runs `seed` on it, then closes it.
 * Connections from `open` and the temporary directory are released when the test finishes.
 */
export function upgradeFrom<Seeded>(
  tag: string,
  seed: (db: SeedDatabase) => Seeded,
): UpgradeFixture<Seeded> {
  const directory = scratchDirectory("migration");
  const opened: ServerDatabase[] = [];

  // onTestFinished runs last-registered first, so connections close before the directory is removed.
  onTestFinished(() => {
    for (const db of opened) if (db.$client.open) db.$client.close();
  });

  const path = join(directory, "upgrade.db");

  const connect = (config: ServerConfig) => {
    const db = createDatabase(config);
    opened.push(db);

    return db;
  };

  const old = connect(
    testServerConfig({ database: { path, migrationsDir: migrationFolder(directory, tag) } }),
  );

  expect(appliedMigrations(old)).toEqual(migrationsThrough(tag));

  const seeded = seed(old);
  old.$client.close();
  const headConfig = testServerConfig({ database: { path, migrationsDir: MIGRATIONS_DIR } });

  return {
    path,
    headConfig,
    seeded,
    open: () => {
      const db = connect(headConfig);
      expectHead(db);

      return db;
    },
  };
}

export interface OwnerSeed {
  readonly id: string;
  readonly email?: string;
  readonly createdAt?: number;
  readonly deletedAt?: number;
}

/**
 * Inserts account owners by the column names of the real `users` schema. Only columns present
 * since the first migration are written, so this also seeds databases at any old tag.
 */
export function seedOwners(db: DatabaseReader, owners: readonly OwnerSeed[]): void {
  const insert = db.$client.prepare(
    `INSERT INTO "${getTableName(users)}" ("${users.id.name}", "${users.email.name}", "${users.createdAt.name}", "${users.deletedAt.name}") VALUES (?, ?, ?, ?)`,
  );

  for (const owner of owners)
    insert.run(
      owner.id,
      owner.email ?? `${owner.id}@example.test`,
      owner.createdAt ?? 0,
      owner.deletedAt ?? null,
    );
}
