import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Tables owned by the auth module (E5 spec data model). Timestamps are
 * integer milliseconds since the epoch; tokens are stored as SHA-256 hashes
 * only. Cross-module foreign keys are deliberately omitted: each module owns
 * its tables and other modules reach them through exported services.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  userAgent: text("user_agent"),
});

export const loginTokens = sqliteTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

export type UsersRow = typeof users.$inferSelect;

export type SessionsRow = typeof sessions.$inferSelect;

export type LoginTokensRow = typeof loginTokens.$inferSelect;
