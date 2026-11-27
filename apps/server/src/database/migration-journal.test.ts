import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

/**
 * Drizzle applies a journal entry only when its `when` is newer than the last applied one
 * (`drizzle-orm/sqlite-core/dialect.js`). A renamed or merged migration that keeps an older
 * `when` is skipped silently on every database that is already ahead, so the journal is checked
 * as committed, without opening a database.
 */
const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../drizzle");

const REGENERATE = "regenerate with `pnpm --filter @voltonaut/server db:generate`, do not rename";

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), when: z.number().int(), tag: z.string() })),
});

const ENTRIES = JournalSchema.parse(
  JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")),
).entries;

const TAGS = ENTRIES.map((entry) => entry.tag);

const SQL_TAGS = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.slice(0, -".sql".length));

function numberingFindings(): readonly string[] {
  const findings: string[] = [];

  for (const [position, entry] of ENTRIES.entries()) {
    const prefix = `${String(position).padStart(4, "0")}_`;

    if (entry.idx !== position || !entry.tag.startsWith(prefix)) {
      findings.push(`${entry.tag} (idx ${entry.idx}) sits at position ${position}; ${REGENERATE}`);
    }
  }

  return findings;
}

function pairingFindings(): readonly string[] {
  const findings: string[] = [];

  for (const [position, tag] of TAGS.entries()) {
    if (TAGS.indexOf(tag) !== position) findings.push(`journal lists ${tag} twice; ${REGENERATE}`);

    if (!SQL_TAGS.includes(tag)) findings.push(`journal lists ${tag} but ${tag}.sql is missing`);
  }

  for (const tag of SQL_TAGS) {
    if (!TAGS.includes(tag)) findings.push(`drizzle/${tag}.sql is not in the journal, never runs`);
  }

  return findings;
}

function orderFindings(): readonly string[] {
  const findings: string[] = [];

  for (const [position, entry] of ENTRIES.entries()) {
    const previous = ENTRIES[position - 1];

    if (previous !== undefined && entry.when <= previous.when) {
      findings.push(
        `${entry.tag} when ${entry.when} <= ${previous.tag} when ${previous.when}; ${REGENERATE}`,
      );
    }
  }

  return findings;
}

it("numbers journal entries gaplessly from 0 and prefixes each tag with its index", () => {
  expect(numberingFindings()).toEqual([]);
});

it("pairs every journal tag with exactly one SQL file", () => {
  expect(pairingFindings()).toEqual([]);
});

it("orders journal timestamps strictly so drizzle never skips a migration", () => {
  expect(orderFindings()).toEqual([]);
});
