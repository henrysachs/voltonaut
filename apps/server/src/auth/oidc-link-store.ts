import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { ApiError } from "../api-error.js";
import { authIdentities, oidcHandoffs } from "./auth.schema.js";
import { hashToken } from "./tokens.js";
import { assertIdentityNotTombstoned } from "./auth-recreation-guards.js";

export interface LinkHandoff {
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly sessionHash: string;
}

/**
 * Deletes the matching account-link handoff and returns it, or undefined when it is used,
 * expired, bound to another browser or a login handoff.
 */
export function takeLinkHandoff(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  take: Readonly<{ code: string; binding: string }>,
  nowMs: number,
): LinkHandoff | undefined {
  const row = db
    .delete(oidcHandoffs)
    .where(
      and(
        eq(oidcHandoffs.codeHash, hashToken(take.code)),
        eq(oidcHandoffs.bindingHash, hashToken(take.binding)),
        gt(oidcHandoffs.expiresAt, nowMs),
        isNotNull(oidcHandoffs.linkIssuer),
      ),
    )
    .returning()
    .get();

  if (
    row === undefined ||
    row.linkIssuer === null ||
    row.linkSubject === null ||
    row.linkSessionHash === null
  )
    return undefined;

  return {
    userId: row.userId,
    issuer: row.linkIssuer,
    subject: row.linkSubject,
    sessionHash: row.linkSessionHash,
  };
}

/**
 * Connects a verified provider identity to the account. Linking the same identity again is a
 * no-op; an identity that belongs to another account is never taken over or merged.
 */
export function linkIdentity(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  link: Readonly<{ userId: string; issuer: string; subject: string }>,
): void {
  db.transaction(
    () => {
      const existing = db
        .select({ userId: authIdentities.userId })
        .from(authIdentities)
        .where(
          and(eq(authIdentities.issuer, link.issuer), eq(authIdentities.subject, link.subject)),
        )
        .get();

      if (existing !== undefined) {
        if (existing.userId !== link.userId)
          throw new ApiError(
            409,
            "identity_in_use",
            "this login already belongs to another account",
          );

        return;
      }

      assertIdentityNotTombstoned(db, link.issuer, link.subject);
      db.insert(authIdentities)
        .values({ issuer: link.issuer, subject: link.subject, userId: link.userId })
        .run();
    },
    { behavior: "immediate" },
  );
}

/** Issuers of every login identity of the account, in a stable order. */
export function identityIssuersOf(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
  db: ServerDatabase,
  userId: string,
): readonly string[] {
  return db
    .select({ issuer: authIdentities.issuer })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId))
    .orderBy(asc(authIdentities.issuer), asc(authIdentities.subject))
    .all()
    .map((row) => row.issuer);
}
