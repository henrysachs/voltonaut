import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

interface LedgerColumns {
  readonly id: SQLiteColumn;
  readonly userId: SQLiteColumn;
  readonly deltaVolts: SQLiteColumn;
  readonly reason: SQLiteColumn;
  readonly refId: SQLiteColumn;
  readonly idempotencyKey: SQLiteColumn;
  readonly rewardDay: SQLiteColumn;
  readonly startTick: SQLiteColumn;
  readonly endTick: SQLiteColumn;
  readonly candidateVolts: SQLiteColumn;
  readonly cumulativeWorkVolts: SQLiteColumn;
  readonly cumulativeClimbVolts: SQLiteColumn;
  readonly cumulativeFactsJson: SQLiteColumn;
  readonly createdAt: SQLiteColumn;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle column metadata remains mutable for query builders.
function ledgerIndexes(table: Readonly<LedgerColumns>) {
  return [
    uniqueIndex("volts_ledger_owner_idempotency_unique").on(table.userId, table.idempotencyKey),
    uniqueIndex("volts_ledger_ride_start_unique")
      .on(table.refId, table.startTick)
      .where(sql`${table.reason} = 'ride_reward'`),
    uniqueIndex("volts_ledger_ride_end_unique")
      .on(table.refId, table.endTick)
      .where(sql`${table.reason} = 'ride_reward'`),
    index("volts_ledger_owner_day_reason_idx").on(table.userId, table.rewardDay, table.reason),
    index("volts_ledger_owner_created_id_idx").on(table.userId, table.createdAt, table.id),
  ];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle column metadata remains mutable for SQL builders.
function ledgerChecks(table: Readonly<LedgerColumns>) {
  return [
    check(
      "volts_ledger_safe_delta",
      sql`typeof(${table.deltaVolts}) = 'integer' AND ${table.deltaVolts} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check("volts_ledger_reason", sql`${table.reason} IN ('ride_reward', 'purchase')`),
    check(
      "volts_ledger_ride_reward",
      sql`${table.reason} <> 'ride_reward' OR (${table.rewardDay} IS NOT NULL AND ${table.startTick} IS NOT NULL AND ${table.endTick} IS NOT NULL AND ${table.candidateVolts} IS NOT NULL AND ${table.cumulativeWorkVolts} IS NOT NULL AND ${table.cumulativeClimbVolts} IS NOT NULL AND ${table.cumulativeFactsJson} IS NOT NULL AND ${table.deltaVolts} >= 0)`,
    ),
    check(
      "volts_ledger_purchase",
      sql`${table.reason} <> 'purchase' OR (${table.rewardDay} IS NULL AND ${table.startTick} IS NULL AND ${table.endTick} IS NULL AND ${table.candidateVolts} IS NULL AND ${table.cumulativeWorkVolts} IS NULL AND ${table.cumulativeClimbVolts} IS NULL AND ${table.cumulativeFactsJson} IS NULL AND ${table.deltaVolts} < 0)`,
    ),
    check(
      "volts_ledger_ticks",
      sql`(${table.startTick} IS NULL AND ${table.endTick} IS NULL) OR (typeof(${table.startTick}) = 'integer' AND ${table.startTick} BETWEEN 0 AND 9007199254740991 AND typeof(${table.endTick}) = 'integer' AND ${table.endTick} BETWEEN 0 AND 9007199254740991 AND ${table.endTick} > ${table.startTick})`,
    ),
    check(
      "volts_ledger_candidate_volts",
      sql`${table.candidateVolts} IS NULL OR (typeof(${table.candidateVolts}) = 'integer' AND ${table.candidateVolts} BETWEEN 0 AND 9007199254740991)`,
    ),
    check(
      "volts_ledger_cumulative_volts",
      sql`(${table.cumulativeWorkVolts} IS NULL AND ${table.cumulativeClimbVolts} IS NULL) OR (typeof(${table.cumulativeWorkVolts}) = 'integer' AND ${table.cumulativeWorkVolts} BETWEEN 0 AND 9007199254740991 AND typeof(${table.cumulativeClimbVolts}) = 'integer' AND ${table.cumulativeClimbVolts} BETWEEN 0 AND 9007199254740991)`,
    ),
  ];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
export function createEconomyTables(userIdColumn: SQLiteColumn) {
  const voltsLedger = sqliteTable(
    "volts_ledger",
    {
      id: text("id").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      deltaVolts: integer("delta_volts").notNull(),
      reason: text("reason", { enum: ["ride_reward", "purchase"] }).notNull(),
      refId: text("ref_id").notNull(),
      idempotencyKey: text("idempotency_key").notNull(),
      payloadHash: text("payload_hash").notNull(),
      rewardDay: text("reward_day"),
      startTick: integer("start_tick"),
      endTick: integer("end_tick"),
      candidateVolts: integer("candidate_volts"),
      cumulativeWorkVolts: integer("cumulative_work_volts"),
      cumulativeClimbVolts: integer("cumulative_climb_volts"),
      cumulativeFactsJson: text("cumulative_facts_json"),
      createdAt: integer("created_at").notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle constructs constraint metadata from mutable columns.
    (table) => [...ledgerIndexes(table), ...ledgerChecks(table)],
  );

  return { voltsLedger };
}

export type EconomyTables = ReturnType<typeof createEconomyTables>;

export const ECONOMY_TABLES: unique symbol = Symbol("voltonaut:economy-tables");
