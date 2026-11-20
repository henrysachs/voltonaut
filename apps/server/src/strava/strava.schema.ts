import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
export function createStravaTables(userIdColumn: SQLiteColumn) {
  const transactions = sqliteTable(
    "strava_transactions",
    {
      stateHash: text("state_hash").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      bindingHash: text("binding_hash").notNull(),
      expiresAt: integer("expires_at").notNull(),
      claimedAt: integer("claimed_at"),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle infers mutable column metadata for index construction.
    (table) => [uniqueIndex("strava_transactions_user_unique").on(table.userId)],
  );

  const connections = sqliteTable(
    "strava_connections",
    {
      userId: text("user_id")
        .primaryKey()
        .references(() => userIdColumn),
      athleteId: text("athlete_id").notNull(),
      status: text("status", { enum: ["pending", "connected", "revocation_pending"] }).notNull(),
      encryptedTokens: text("encrypted_tokens").notNull(),
      accessExpiresAt: integer("access_expires_at").notNull(),
      scope: text("scope").notNull(),
      revokeLeaseUntil: integer("revoke_lease_until").notNull().default(0),
      handoffHash: text("handoff_hash"),
      bindingHash: text("binding_hash"),
      confirmBy: integer("confirm_by"),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle infers mutable column metadata for constraint construction.
    (table) => [
      uniqueIndex("strava_connections_athlete_unique").on(table.athleteId),
      uniqueIndex("strava_connections_handoff_unique").on(table.handoffHash),
      check(
        "strava_connection_state",
        sql`(${table.status} = 'pending' AND ${table.handoffHash} IS NOT NULL AND ${table.bindingHash} IS NOT NULL AND ${table.confirmBy} IS NOT NULL) OR (${table.status} IN ('connected', 'revocation_pending') AND ${table.handoffHash} IS NULL AND ${table.bindingHash} IS NULL AND ${table.confirmBy} IS NULL)`,
      ),
      check("strava_connection_scope", sql`${table.scope} = 'activity:write'`),
    ],
  );

  return { transactions, connections };
}

export type StravaTables = ReturnType<typeof createStravaTables>;

export const STRAVA_TABLES: unique symbol = Symbol("voltonaut:strava-tables");
