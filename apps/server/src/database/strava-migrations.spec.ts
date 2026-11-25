import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { encryptTokens } from "../strava/strava.crypto.js";

export function legacyFolder(directory: string, count: number): string {
  const source = resolve("apps/server/drizzle");
  const destination = join(directory, "legacy");

  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")));

  const entries = journal.entries.slice(0, count);
  mkdirSync(join(destination, "meta"), { recursive: true });

  for (const entry of entries)
    copyFileSync(join(source, `${entry.tag}.sql`), join(destination, `${entry.tag}.sql`));
  writeFileSync(join(destination, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return destination;
}

export function legacyStrava(
  directory: string,
  key: string,
  tokens: Parameters<typeof encryptTokens>[0],
) {
  const previous = new Database(join(directory, "existing.db"));
  migrate(drizzle(previous), { migrationsFolder: legacyFolder(directory, 5) });
  previous.exec(
    "INSERT INTO users (id, email, created_at, deleted_at) VALUES ('first', 'first@example.test', 123, NULL), ('second', 'second@example.test', 123, NULL)",
  );

  for (const { userId, athleteId } of [
    { userId: "first", athleteId: "41" },
    { userId: "second", athleteId: "42" },
  ]) {
    previous
      .prepare(
        "INSERT INTO strava_connections(user_id,athlete_id,status,encrypted_tokens,access_expires_at,scope) VALUES (?,?,'connected',?,999999,'activity:write')",
      )
      .run(userId, athleteId, encryptTokens(tokens, key, userId, athleteId));
  }

  const before = previous.prepare("SELECT * FROM strava_connections ORDER BY user_id").all();
  previous.close();

  return before;
}
