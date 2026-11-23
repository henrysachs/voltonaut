import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
export function createStravaTables(userIdColumn: SQLiteColumn) {
  return {
    transactions: createTransactions(userIdColumn),
    connections: createConnections(userIdColumn),
    deliveries: createDeliveries(userIdColumn),
    rateBudget: createRateBudget(),
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require original column metadata.
function createTransactions(userIdColumn: SQLiteColumn) {
  return sqliteTable(
    "strava_transactions",
    {
      stateHash: text("state_hash").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      bindingHash: text("binding_hash").notNull(),
      expiresAt: integer("expires_at").notNull(),
      claimedAt: integer("claimed_at"),
      channel: text("channel").notNull().default(""),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle infers mutable column metadata for index construction.
    (table) => [uniqueIndex("strava_transactions_user_unique").on(table.userId)],
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require original column metadata.
function createConnections(userIdColumn: SQLiteColumn) {
  return sqliteTable(
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
      generation: text("generation").notNull().default(""),
      tokenRevision: integer("token_revision").notNull().default(0),
      credentialState: text("credential_state", {
        enum: ["available", "refreshing", "uncertain", "reauthorization_required"],
      })
        .notNull()
        .default("available"),
      workOwner: text("work_owner"),
      workKind: text("work_kind", { enum: ["refresh", "submit", "poll", "revoke"] }),
      workUntil: integer("work_until").notNull().default(0),
      authorizationHintRevision: integer("authorization_hint_revision").notNull().default(0),
      authorizationCheckedRevision: integer("authorization_checked_revision").notNull().default(0),
      authorizationCheckAfter: integer("authorization_check_after").notNull().default(0),
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
      check(
        "strava_credential_state",
        sql`credential_state IN ('available','refreshing','uncertain','reauthorization_required')`,
      ),
      check("strava_work_kind", sql`work_kind IN ('refresh','submit','poll','revoke')`),
    ],
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require original column metadata.
function createDeliveries(userIdColumn: SQLiteColumn) {
  return sqliteTable(
    "strava_deliveries",
    {
      deliveryId: text("delivery_id").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      rideId: text("ride_id").notNull(),
      authority: text("authority").notNull(),
      progress: text("progress").notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle constructs index metadata.
    (table) => [
      uniqueIndex("strava_deliveries_owner_ride").on(table.userId, table.rideId),
      check(
        "strava_delivery_authority_kind",
        sql`json_valid(authority) AND COALESCE(json_extract(authority,'$.kind') IN ('consented','stopped'),0)`,
      ),
      check(
        "strava_delivery_progress_kind",
        sql`json_valid(progress) AND COALESCE(json_extract(progress,'$.kind') IN ('queued','preparing','submitting','submission_unknown','processing','delivered','submission_rejected','processing_rejected'),0)`,
      ),
      check(
        "strava_delivery_own_ride",
        sql`COALESCE(json_extract(authority,'$.consent.rideId') = ride_id AND json_type(authority,'$.consent') = 'object',0)`,
      ),
      check(
        "strava_delivery_authority_state",
        sql`COALESCE(CASE json_extract(authority,'$.kind') WHEN 'consented' THEN json_type(authority,'$.consentedAtMs') = 'integer' WHEN 'stopped' THEN json_type(authority,'$.stoppedAtMs') = 'integer' AND json_extract(authority,'$.reason') IN ('disconnect','credentials','policy') END,0)`,
      ),
      check(
        "strava_delivery_progress_state",
        sql`COALESCE(CASE json_extract(progress,'$.kind') WHEN 'queued' THEN json_type(progress,'$.notBeforeMs') = 'integer' WHEN 'preparing' THEN json_type(progress,'$.owner') = 'text' AND json_type(progress,'$.leaseUntilMs') = 'integer' WHEN 'submitting' THEN json_type(progress,'$.attemptId') = 'text' AND json_type(progress,'$.startedAtMs') = 'integer' AND json_type(progress,'$.leaseUntilMs') = 'integer' WHEN 'submission_unknown' THEN json_type(progress,'$.attemptId') = 'text' AND json_extract(progress,'$.reason') IN ('response_lost','crash','protocol') WHEN 'processing' THEN json_type(progress,'$.nextPollAtMs') = 'integer' AND json_extract(progress,'$.issue') IN ('none','authorization','rate_limit','network','protocol') WHEN 'delivered' THEN json_type(progress,'$.activityId') = 'text' AND json_type(progress,'$.confirmedAtMs') = 'integer' WHEN 'submission_rejected' THEN json_extract(progress,'$.reason') IN ('authorization','rate_limit','file','provider') WHEN 'processing_rejected' THEN json_extract(progress,'$.reason') = 'provider_error' END,0)`,
      ),
      check(
        "strava_delivery_receipt",
        sql`CASE WHEN json_extract(progress,'$.kind') IN ('processing','delivered','processing_rejected') THEN COALESCE(json_type(progress,'$.receipt.uploadId') = 'text' AND json_type(progress,'$.receipt.externalId') = 'text',0) ELSE 1 END`,
      ),
    ],
  );
}

function createRateBudget() {
  return sqliteTable(
    "strava_rate_budget",
    {
      id: integer("id").primaryKey(),
      shortReset: integer("short_reset").notNull(),
      dayReset: integer("day_reset").notNull(),
      shortLimit: integer("short_limit").notNull().default(1),
      dayLimit: integer("day_limit").notNull().default(1),
      readShortLimit: integer("read_short_limit").notNull().default(1),
      readDayLimit: integer("read_day_limit").notNull().default(1),
      shortUsage: integer("short_usage").notNull().default(0),
      dayUsage: integer("day_usage").notNull().default(0),
      readShortUsage: integer("read_short_usage").notNull().default(0),
      readDayUsage: integer("read_day_usage").notNull().default(0),
      shortPending: integer("short_pending").notNull().default(0),
      dayPending: integer("day_pending").notNull().default(0),
      readShortPending: integer("read_short_pending").notNull().default(0),
      readDayPending: integer("read_day_pending").notNull().default(0),
      blockedUntil: integer("blocked_until").notNull().default(0),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle constructs constraint metadata from mutable columns.
    (table) => [check("strava_rate_singleton", sql`${table.id} = 1`)],
  );
}

export type StravaTables = ReturnType<typeof createStravaTables>;

export const STRAVA_TABLES: unique symbol = Symbol("voltonaut:strava-tables");
