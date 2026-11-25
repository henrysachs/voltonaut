import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** Owned items beyond the catalog defaults (spec E7-02 AK3). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata.
export function createInventoryTables(userIdColumn: SQLiteColumn) {
  const inventory = sqliteTable(
    "inventory",
    {
      userId: text("user_id")
        .notNull()
        .references(() => userIdColumn),
      itemId: text("item_id").notNull(),
      source: text("source", { enum: ["shop"] }).notNull(),
      purchaseRequestId: text("purchase_request_id"),
      acquiredAt: integer("acquired_at").notNull(),
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle column metadata remains mutable for SQL builders.
    (table) => [
      primaryKey({ columns: [table.userId, table.itemId] }),
      uniqueIndex("inventory_owner_purchase_request_unique").on(
        table.userId,
        table.purchaseRequestId,
      ),
      check("inventory_source", sql`${table.source} IN ('shop')`),
      check(
        "inventory_shop_request",
        sql`${table.source} <> 'shop' OR ${table.purchaseRequestId} IS NOT NULL`,
      ),
      check(
        "inventory_acquired_at",
        sql`typeof(${table.acquiredAt}) = 'integer' AND ${table.acquiredAt} >= 0`,
      ),
    ],
  );

  return { inventory };
}

export type InventoryTables = ReturnType<typeof createInventoryTables>;

export const INVENTORY_TABLES: unique symbol = Symbol("voltonaut:inventory-tables");
