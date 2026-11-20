import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle references require the original column metadata, not a copied readonly model.
export function createAccountsTables(userIdColumn: SQLiteColumn) {
  const profiles = sqliteTable("profiles", {
    userId: text("user_id")
      .primaryKey()
      .references(() => userIdColumn),
    profileJson: text("profile_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  });

  return { profiles };
}

export type AccountsTables = ReturnType<typeof createAccountsTables>;

export const ACCOUNTS_TABLES: unique symbol = Symbol("voltonaut:accounts-tables");
