import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql, type SQLWrapper } from "drizzle-orm";
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

  const accountStatus = sqliteTable(
    "account_status",
    {
      userId: text("user_id")
        .primaryKey()
        .references(() => userIdColumn),
      tier: text("tier", { enum: ["normal", "premium", "pro"] })
        .notNull()
        .default("normal"),
      vip: integer("vip", { mode: "boolean" }).notNull().default(false),
      role: text("role", { enum: ["user", "admin"] })
        .notNull()
        .default("user"),
    },
    (table: {
      readonly tier: Readonly<SQLWrapper>;
      readonly vip: Readonly<SQLWrapper>;
      readonly role: Readonly<SQLWrapper>;
    }) => [
      check("account_status_tier", sql`${table.tier} IN ('normal', 'premium', 'pro')`),
      check("account_status_vip", sql`${table.vip} IN (0, 1)`),
      check("account_status_role", sql`${table.role} IN ('user', 'admin')`),
    ],
  );

  return { profiles, accountStatus };
}

export type AccountsTables = ReturnType<typeof createAccountsTables>;

export const ACCOUNTS_TABLES: unique symbol = Symbol("voltonaut:accounts-tables");
