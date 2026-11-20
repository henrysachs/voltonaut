import Database from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ServerConfig } from "../config.js";

export const DRIZZLE: unique symbol = Symbol("voltonaut:drizzle");

export type ServerDatabase = BetterSQLite3Database & {
  $client: DatabaseInstance;
};

function resolveMigrationsFolder(dir: string): string {
  if (dir.startsWith("/")) {
    return resolve(dir);
  }

  const direct = resolve(join(process.cwd(), dir));

  if (existsSync(join(direct, "meta", "_journal.json"))) {
    return direct;
  }

  const packageRelative = resolve(join(process.cwd(), "apps", "server", dir));

  if (existsSync(join(packageRelative, "meta", "_journal.json"))) {
    return packageRelative;
  }

  return direct;
}

export function createDatabase(config: ServerConfig): ServerDatabase {
  if (config.database.path !== ":memory:") {
    mkdirSync(dirname(resolve(config.database.path)), { recursive: true });
  }

  const client = new Database(config.database.path);

  try {
    client.pragma("journal_mode = WAL");
    client.pragma("foreign_keys = ON");

    const db = drizzle(client);

    migrate(db, { migrationsFolder: resolveMigrationsFolder(config.database.migrationsDir) });

    return db;
  } catch (error) {
    client.close();
    throw error;
  }
}
