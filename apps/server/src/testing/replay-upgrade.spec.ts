import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CompletedLocalRideSchema, type CompletedLocalRide } from "@voltonaut/shared";
import { createDatabase, type ServerDatabase } from "../database/drizzle.provider.js";
import { testServerConfig } from "../config.js";
import { recording } from "./recording.spec.js";

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

function oldMigrations(directory: string): string {
  const migrationsDir = join(directory, "migrations");
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });

  const originalDir = resolve(import.meta.dirname, "../../drizzle");

  const journal = JournalSchema.parse(
    JSON.parse(readFileSync(join(originalDir, "meta/_journal.json"), "utf8")),
  );

  const entries = journal.entries.filter((entry) => entry.idx <= 3);

  for (const entry of entries)
    cpSync(join(originalDir, `${entry.tag}.sql`), join(migrationsDir, `${entry.tag}.sql`));

  writeFileSync(join(migrationsDir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  return migrationsDir;
}

interface LegacyCopy {
  readonly path: string;
  readonly ride: CompletedLocalRide;
  readonly payload: string;
  readonly hash: string;
  readonly receipt: string;
  readonly token: string;
}

function insertLegacy(
  client: Readonly<Pick<ServerDatabase["$client"], "prepare">>,
  old: LegacyCopy,
  nowMs: number,
): void {
  client
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
    .run("old-owner", "upgrade@example.com", nowMs);
  client
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      createHash("sha256").update(old.token).digest("hex"),
      "old-owner",
      nowMs,
      nowMs,
      nowMs + 60000,
    );
  client
    .prepare(
      "INSERT INTO rides (id, user_id, payload_json, payload_hash, receipt_json, assessment_json, started_at, uploaded_at, duration_ms, distance_m, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      old.ride.rideId,
      "old-owner",
      old.payload,
      old.hash,
      old.receipt,
      JSON.stringify({ status: "unverified", reason: "legacy_missing_replay" }),
      old.ride.startedAt,
      nowMs,
      1000,
      5,
      "sim",
    );
}

export function legacyDatabase(directory: string): LegacyCopy {
  const migrationsDir = oldMigrations(directory);
  const path = join(directory, "rides.sqlite");
  const db = createDatabase(testServerConfig({ database: { path, migrationsDir } }));
  const ride = CompletedLocalRideSchema.parse(recording());
  const payload = JSON.stringify(ride);
  const hash = createHash("sha256").update(payload).digest("hex");

  const receipt = JSON.stringify({
    rideId: ride.rideId,
    storage: "stored",
    assessment: { status: "unverified", reason: "legacy_missing_replay" },
  });

  const old = { path, ride, payload, hash, receipt, token: "temporary-upgrade-session" };

  try {
    insertLegacy(db.$client, old, Date.now());
  } finally {
    db.$client.close();
  }

  return old;
}
