import { and, count, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { ApiError } from "../api-error.js";
import type { AuthService } from "./auth.service.js";
import { invalidOidcLogin } from "./oidc-cookie.js";
import { users, authIdentities, oidcTransactions, oidcHandoffs } from "./auth.schema.js";
import type { IdentityClaims } from "./oidc-client.js";
import { hashToken } from "./tokens.js";
import { assertOidcIdentityAvailable } from "./auth-recreation-guards.js";

export const OIDC_TRANSACTION_TTL_MS = 5 * 60_000;
export const OIDC_HANDOFF_TTL_MS = 60_000;

export type OidcTransactionRow = Readonly<typeof oidcTransactions.$inferSelect>;

/**
 * Finds or creates the Voltonaut user for a verified provider identity. The identity key is
 * `(issuer, subject)`; an email match alone never links accounts. A provider's email
 * verification only gates creating a new account; a known identity signs in regardless.
 */
function resolveIdentityUser(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  auth: Pick<AuthService, "currentUser">,
  login: Readonly<{ identity: IdentityClaims; requireEmailVerified: boolean }>,
  nowMs: number,
  hmacKey: string,
): string {
  const { identity } = login;

  const existing = db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.issuer, identity.iss), eq(authIdentities.subject, identity.sub)))
    .get();

  if (existing !== undefined) {
    auth.currentUser(existing.userId);

    return existing.userId;
  }

  if (login.requireEmailVerified && identity.email_verified !== true)
    throw new ApiError(
      403,
      "email_not_verified",
      "the login provider did not verify the email address",
    );

  assertOidcIdentityAvailable(db, hmacKey, identity);

  if (db.select().from(users).where(eq(users.email, identity.email)).get() !== undefined) {
    throw new ApiError(409, "identity_conflict", "existing account ownership must be proven");
  }

  const userId = crypto.randomUUID();
  db.insert(users).values({ id: userId, email: identity.email, createdAt: nowMs }).run();
  db.insert(authIdentities).values({ issuer: identity.iss, subject: identity.sub, userId }).run();

  return userId;
}

/** Deletes at most 100 expired rows per table. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
export function cleanupOidcRows(db: ServerDatabase, nowMs: number): void {
  db.delete(oidcTransactions)
    .where(
      inArray(
        oidcTransactions.stateHash,
        db
          .select({ key: oidcTransactions.stateHash })
          .from(oidcTransactions)
          .where(lte(oidcTransactions.expiresAt, nowMs))
          .limit(100),
      ),
    )
    .run();
  db.delete(oidcHandoffs)
    .where(
      inArray(
        oidcHandoffs.codeHash,
        db
          .select({ key: oidcHandoffs.codeHash })
          .from(oidcHandoffs)
          .where(lte(oidcHandoffs.expiresAt, nowMs))
          .limit(100),
      ),
    )
    .run();
}

export interface NewTransaction {
  readonly state: string;
  readonly binding: string;
  readonly provider: string;
  readonly nonce: string;
  readonly verifier: string;
  /** Set only for an explicit account link started by this signed-in session. */
  readonly link: Readonly<{ userId: string; sessionHash: string }> | undefined;
}

/** Stores a login transaction unless the shared capacity limit of 1000 rows is reached. */
export function insertTransaction(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  transaction: Readonly<NewTransaction>,
  nowMs: number,
): void {
  db.transaction(
    () => {
      const active = db.select({ total: count() }).from(oidcTransactions).get();
      const handoffs = db.select({ total: count() }).from(oidcHandoffs).get();

      if ((active?.total ?? 0) + (handoffs?.total ?? 0) >= 1000)
        throw new ApiError(429, "rate_limited", "too many login attempts");
      db.insert(oidcTransactions)
        .values({
          stateHash: hashToken(transaction.state),
          provider: transaction.provider,
          bindingHash: hashToken(transaction.binding),
          nonce: transaction.nonce,
          verifier: transaction.verifier,
          linkUserId: transaction.link?.userId ?? null,
          linkSessionHash: transaction.link?.sessionHash ?? null,
          expiresAt: nowMs + OIDC_TRANSACTION_TTL_MS,
        })
        .run();
    },
    { behavior: "immediate" },
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
export function deleteTransaction(db: ServerDatabase, stateHash: string): void {
  db.delete(oidcTransactions).where(eq(oidcTransactions.stateHash, stateHash)).run();
}

/** Atomically claims the unused, unexpired transaction of exactly this provider and browser. */
export function claimTransaction(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  claim: Readonly<{ state: string; binding: string; provider: string }>,
  nowMs: number,
): OidcTransactionRow | undefined {
  return db
    .update(oidcTransactions)
    .set({ claimedAt: nowMs })
    .where(
      and(
        eq(oidcTransactions.stateHash, hashToken(claim.state)),
        eq(oidcTransactions.provider, claim.provider),
        eq(oidcTransactions.bindingHash, hashToken(claim.binding)),
        gt(oidcTransactions.expiresAt, nowMs),
        isNull(oidcTransactions.claimedAt),
      ),
    )
    .returning()
    .get();
}

/** Removes the claimed reservation inside the caller's transaction; fails once it expired. */
function consumeReservation(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  transaction: OidcTransactionRow,
  nowMs: number,
): void {
  const reservation = db
    .delete(oidcTransactions)
    .where(
      and(
        eq(oidcTransactions.stateHash, transaction.stateHash),
        gt(oidcTransactions.expiresAt, nowMs),
      ),
    )
    .returning()
    .get();

  if (reservation === undefined) throw invalidOidcLogin();
}

/** Replaces the claimed transaction by a one-time handoff for the resolved user. */
export function replaceTransactionByHandoff(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  auth: Pick<AuthService, "currentUser">,
  grant: Readonly<{
    identity: IdentityClaims;
    requireEmailVerified: boolean;
    transaction: OidcTransactionRow;
    code: string;
  }>,
  nowMs: number,
  hmacKey: string,
): void {
  db.transaction(
    () => {
      consumeReservation(db, grant.transaction, nowMs);
      const userId = resolveIdentityUser(db, auth, grant, nowMs, hmacKey);
      cleanupOidcRows(db, nowMs);
      db.insert(oidcHandoffs)
        .values({
          codeHash: hashToken(grant.code),
          bindingHash: grant.transaction.bindingHash,
          userId,
          expiresAt: nowMs + OIDC_HANDOFF_TTL_MS,
        })
        .run();
    },
    { behavior: "immediate" },
  );
}

/**
 * Replaces a claimed account-link transaction by a one-time link handoff. It carries the verified
 * identity, the target account and the requesting session; nothing is linked until that same
 * session completes it.
 */
export function replaceTransactionByLinkHandoff(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  grant: Readonly<{ identity: IdentityClaims; transaction: OidcTransactionRow; code: string }>,
  nowMs: number,
): void {
  const { linkUserId, linkSessionHash } = grant.transaction;

  if (linkUserId === null || linkSessionHash === null) throw invalidOidcLogin();
  db.transaction(
    () => {
      const owner = db
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, linkUserId))
        .get();

      if (owner === undefined || owner.deletedAt !== null) throw invalidOidcLogin();
      consumeReservation(db, grant.transaction, nowMs);
      cleanupOidcRows(db, nowMs);
      db.insert(oidcHandoffs)
        .values({
          codeHash: hashToken(grant.code),
          bindingHash: grant.transaction.bindingHash,
          userId: linkUserId,
          expiresAt: nowMs + OIDC_HANDOFF_TTL_MS,
          linkIssuer: grant.identity.iss,
          linkSubject: grant.identity.sub,
          linkSessionHash,
        })
        .run();
    },
    { behavior: "immediate" },
  );
}

/**
 * Deletes the matching login handoff and returns its user, or undefined when used, expired,
 * foreign or an account link handoff (those only complete through the link endpoint).
 */
export function takeHandoff(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  take: Readonly<{ code: string; binding: string }>,
  nowMs: number,
): string | undefined {
  return db
    .delete(oidcHandoffs)
    .where(
      and(
        eq(oidcHandoffs.codeHash, hashToken(take.code)),
        eq(oidcHandoffs.bindingHash, hashToken(take.binding)),
        gt(oidcHandoffs.expiresAt, nowMs),
        isNull(oidcHandoffs.linkIssuer),
      ),
    )
    .returning()
    .get()?.userId;
}
