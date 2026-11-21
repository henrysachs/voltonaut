import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata, not a copied readonly model.
export function createRidesTables(userIdColumn: SQLiteColumn) {
  const rides = sqliteTable(
    "rides",
    {
      id: text("id").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      payloadJson: text("payload_json").notNull(),
      payloadHash: text("payload_hash").notNull(),
      receiptJson: text("receipt_json").notNull(),
      assessmentJson: text("assessment_json").notNull(),
      summaryJson: text("summary_json"),
      exportTcx: text("export_tcx"),
      exportHash: text("export_hash"),
      exportVersion: text("export_version", { enum: ["tcx-1"] }),
      startedAt: text("started_at").notNull(),
      uploadedAt: integer("uploaded_at").notNull(),
      durationMs: integer("duration_ms").notNull(),
      distanceM: real("distance_m").notNull(),
      source: text("source", { enum: ["sim", "ble"] }).notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle supplies its table metadata to the index callback.
    (table) => [index("rides_owner_id_idx").on(table.userId, table.id)],
  );

  return { rides };
}

export type RidesTables = ReturnType<typeof createRidesTables>;

export const RIDES_TABLES: unique symbol = Symbol("voltonaut:rides-tables");
