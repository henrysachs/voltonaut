import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

interface ConsentColumns {
  readonly userId: SQLiteColumn;
  readonly version: SQLiteColumn;
  readonly enabled: SQLiteColumn;
  readonly sessionHash: SQLiteColumn;
  readonly sessionGeneration: SQLiteColumn;
  readonly updatedAt: SQLiteColumn;
}

interface JournalColumns {
  readonly journalId: SQLiteColumn;
  readonly userId: SQLiteColumn;
  readonly sessionHash: SQLiteColumn;
  readonly sessionGeneration: SQLiteColumn;
  readonly consentVersion: SQLiteColumn;
  readonly source: SQLiteColumn;
  readonly clockScale: SQLiteColumn;
  readonly physicsRevision: SQLiteColumn;
  readonly routeId: SQLiteColumn;
  readonly routeRevision: SQLiteColumn;
  readonly physicsJson: SQLiteColumn;
  readonly startedAtMs: SQLiteColumn;
  readonly lastEndTick: SQLiteColumn;
  readonly lastSequence: SQLiteColumn;
  readonly lastEndedAtMs: SQLiteColumn;
  readonly lastRewardDay: SQLiteColumn;
  readonly cumulativeFactsJson: SQLiteColumn;
  readonly createdAt: SQLiteColumn;
}

interface RangeColumns {
  readonly id: SQLiteColumn;
  readonly journalId: SQLiteColumn;
  readonly userId: SQLiteColumn;
  readonly startTick: SQLiteColumn;
  readonly endTick: SQLiteColumn;
  readonly payloadHash: SQLiteColumn;
  readonly payloadJson: SQLiteColumn;
  readonly cumulativeFactsJson: SQLiteColumn;
  readonly receiptJson: SQLiteColumn;
  readonly createdAt: SQLiteColumn;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle columns retain mutable metadata used by SQL builders.
function consentChecks(table: Readonly<ConsentColumns>) {
  return [
    check(
      "progress_consents_version",
      sql`typeof(${table.version}) = 'integer' AND ${table.version} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "progress_consents_enabled",
      sql`typeof(${table.enabled}) = 'integer' AND ${table.enabled} IN (0, 1)`,
    ),
    check("progress_consents_session_hash", sql`length(${table.sessionHash}) > 0`),
    check(
      "progress_consents_session_generation",
      sql`typeof(${table.sessionGeneration}) = 'integer' AND ${table.sessionGeneration} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "progress_consents_updated_at",
      sql`typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} BETWEEN 0 AND 9007199254740991`,
    ),
  ];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle columns retain mutable metadata used by SQL builders.
function journalChecks(table: Readonly<JournalColumns>) {
  return [
    check("ride_progress_journals_journal_id", sql`length(${table.journalId}) > 0`),
    check("ride_progress_journals_session_hash", sql`length(${table.sessionHash}) > 0`),
    check(
      "ride_progress_journals_session_generation",
      sql`typeof(${table.sessionGeneration}) = 'integer' AND ${table.sessionGeneration} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "ride_progress_journals_consent_version",
      sql`typeof(${table.consentVersion}) = 'integer' AND ${table.consentVersion} > 0`,
    ),
    check("ride_progress_journals_source", sql`${table.source} = 'ble'`),
    check(
      "ride_progress_journals_clock_scale",
      sql`typeof(${table.clockScale}) = 'real' AND ${table.clockScale} = 1`,
    ),
    check("ride_progress_journals_physics_revision", sql`length(${table.physicsRevision}) > 0`),
    check("ride_progress_journals_route_id", sql`length(${table.routeId}) > 0`),
    check("ride_progress_journals_route_revision", sql`length(${table.routeRevision}) > 0`),
    check(
      "ride_progress_journals_physics_json",
      sql`length(${table.physicsJson}) > 0 AND json_valid(${table.physicsJson})`,
    ),
    check(
      "ride_progress_journals_ticks",
      sql`typeof(${table.lastEndTick}) = 'integer' AND ${table.lastEndTick} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "ride_progress_journals_last_sequence",
      sql`typeof(${table.lastSequence}) = 'integer' AND ${table.lastSequence} BETWEEN 0 AND 9007199254740991 AND ${table.lastSequence} < ${table.lastEndTick}`,
    ),
    check(
      "ride_progress_journals_timeline",
      sql`typeof(${table.startedAtMs}) = 'integer' AND ${table.startedAtMs} BETWEEN 0 AND 9007199254740991 AND typeof(${table.lastEndedAtMs}) = 'integer' AND ${table.lastEndedAtMs} BETWEEN ${table.startedAtMs} AND 9007199254740991 AND ${table.lastRewardDay} = date(${table.lastEndedAtMs} / 1000, 'unixepoch')`,
    ),
    check(
      "ride_progress_journals_cumulative_facts_json",
      sql`length(${table.cumulativeFactsJson}) > 0 AND json_valid(${table.cumulativeFactsJson})`,
    ),
    check(
      "ride_progress_journals_created_at",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199254740991`,
    ),
  ];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle columns retain mutable metadata used by SQL builders.
function rangeChecks(table: Readonly<RangeColumns>) {
  return [
    check("ride_progress_ranges_id", sql`length(${table.id}) > 0`),
    check("ride_progress_ranges_journal_id", sql`length(${table.journalId}) > 0`),
    check(
      "ride_progress_ranges_ticks",
      sql`typeof(${table.startTick}) = 'integer' AND ${table.startTick} BETWEEN 0 AND 9007199254740991 AND typeof(${table.endTick}) = 'integer' AND ${table.endTick} BETWEEN 1 AND 9007199254740991 AND ${table.endTick} > ${table.startTick}`,
    ),
    check(
      "ride_progress_ranges_payload_hash",
      sql`length(${table.payloadHash}) = 64 AND ${table.payloadHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "ride_progress_ranges_payload_json",
      sql`length(${table.payloadJson}) > 0 AND json_valid(${table.payloadJson})`,
    ),
    check(
      "ride_progress_ranges_cumulative_facts_json",
      sql`length(${table.cumulativeFactsJson}) > 0 AND json_valid(${table.cumulativeFactsJson})`,
    ),
    check(
      "ride_progress_ranges_receipt_json",
      sql`length(${table.receiptJson}) > 0 AND json_valid(${table.receiptJson})`,
    ),
    check(
      "ride_progress_ranges_created_at",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199254740991`,
    ),
  ];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
function createProgressConsentsTable(userIdColumn: SQLiteColumn) {
  return sqliteTable(
    "progress_consents",
    {
      userId: text("user_id")
        .primaryKey()
        .references(() => userIdColumn),
      version: integer("version").notNull(),
      enabled: integer("enabled", { mode: "boolean" }).notNull(),
      sessionHash: text("session_hash").notNull(),
      sessionGeneration: integer("session_generation").notNull(),
      updatedAt: integer("updated_at").notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle constructs constraint metadata from mutable columns.
    (table) => consentChecks(table),
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
function createRideProgressJournalsTable(userIdColumn: SQLiteColumn) {
  return sqliteTable(
    "ride_progress_journals",
    {
      journalId: text("journal_id").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      sessionHash: text("session_hash").notNull(),
      sessionGeneration: integer("session_generation").notNull(),
      consentVersion: integer("consent_version").notNull(),
      source: text("source", { enum: ["ble"] }).notNull(),
      clockScale: real("clock_scale").notNull(),
      physicsRevision: text("physics_revision").notNull(),
      routeId: text("route_id").notNull(),
      routeRevision: text("route_revision").notNull(),
      physicsJson: text("physics_json").notNull(),
      startedAtMs: integer("started_at_ms").notNull(),
      lastEndTick: integer("last_end_tick").notNull(),
      lastSequence: integer("last_sequence").notNull(),
      lastEndedAtMs: integer("last_ended_at_ms").notNull(),
      lastRewardDay: text("last_reward_day").notNull(),
      cumulativeFactsJson: text("cumulative_facts_json").notNull(),
      createdAt: integer("created_at").notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle constructs index and constraint metadata from mutable columns.
    (table) => [
      index("ride_progress_journals_owner_created_id_idx").on(
        table.userId,
        table.createdAt,
        table.journalId,
      ),
      index("ride_progress_journals_owner_session_idx").on(table.userId, table.sessionHash),
      ...journalChecks(table),
    ],
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
function createRideProgressRangesTable(userIdColumn: SQLiteColumn) {
  return sqliteTable(
    "ride_progress_ranges",
    {
      id: text("id").primaryKey(),
      journalId: text("journal_id").notNull(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      startTick: integer("start_tick").notNull(),
      endTick: integer("end_tick").notNull(),
      payloadHash: text("payload_hash").notNull(),
      payloadJson: text("payload_json").notNull(),
      cumulativeFactsJson: text("cumulative_facts_json").notNull(),
      receiptJson: text("receipt_json").notNull(),
      createdAt: integer("created_at").notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle constructs constraint metadata from mutable columns.
    (table) => [
      uniqueIndex("ride_progress_ranges_journal_start_unique").on(table.journalId, table.startTick),
      uniqueIndex("ride_progress_ranges_journal_end_unique").on(table.journalId, table.endTick),
      index("ride_progress_ranges_owner_created_id_idx").on(
        table.userId,
        table.createdAt,
        table.id,
      ),
      index("ride_progress_ranges_owner_journal_idx").on(
        table.userId,
        table.journalId,
        table.startTick,
      ),
      ...rangeChecks(table),
    ],
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
export function createProgressTables(userIdColumn: SQLiteColumn) {
  return {
    progressConsents: createProgressConsentsTable(userIdColumn),
    rideProgressJournals: createRideProgressJournalsTable(userIdColumn),
    rideProgressRanges: createRideProgressRangesTable(userIdColumn),
  };
}

export type ProgressTables = ReturnType<typeof createProgressTables>;

export type ProgressConsentRow = ProgressTables["progressConsents"]["$inferSelect"];

export type RideProgressJournalRow = ProgressTables["rideProgressJournals"]["$inferSelect"];

export type RideProgressRangeRow = ProgressTables["rideProgressRanges"]["$inferSelect"];

export const PROGRESS_TABLES: unique symbol = Symbol("voltonaut:progress-tables");
