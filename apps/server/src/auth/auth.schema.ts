import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

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
  deletedEmailHash: text("deleted_email_hash"),
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

export const authIdentities = sqliteTable(
  "auth_identities",
  {
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle supplies native mutable column builders to its schema callback.
  (table) => [primaryKey({ columns: [table.issuer, table.subject] })],
);

export const authIdentityTombstones = sqliteTable("auth_identity_tombstones", {
  identityHash: text("identity_hash").primaryKey(),
});

export const oidcTransactions = sqliteTable(
  "oidc_transactions",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull().default(""),
    /** Set only for an explicit account link: the account and session that asked for it. */
    linkUserId: text("link_user_id"),
    linkSessionHash: text("link_session_hash"),
    bindingHash: text("binding_hash").notNull(),
    nonce: text("nonce").notNull(),
    verifier: text("verifier").notNull(),
    expiresAt: integer("expires_at").notNull(),
    claimedAt: integer("claimed_at"),
  },
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle supplies native mutable column builders to its schema callback.
  (table) => [index("oidc_transactions_expiry").on(table.expiresAt)],
);

export const oidcHandoffs = sqliteTable(
  "oidc_handoffs",
  {
    codeHash: text("code_hash").primaryKey(),
    bindingHash: text("binding_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: integer("expires_at").notNull(),
    /** Set only for an account link handoff: the verified identity and the requesting session. */
    linkIssuer: text("link_issuer"),
    linkSubject: text("link_subject"),
    linkSessionHash: text("link_session_hash"),
  },
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle supplies native mutable column builders to its schema callback.
  (table) => [index("oidc_handoffs_expiry").on(table.expiresAt)],
);
