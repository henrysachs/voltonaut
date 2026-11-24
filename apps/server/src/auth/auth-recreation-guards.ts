import { and, eq } from "drizzle-orm";
import type { IdentityClaims } from "./oidc-client.js";
import { invalidOidcLogin } from "./oidc-cookie.js";
import { authIdentities, authIdentityTombstones, users } from "./auth.schema.js";
import type { AuthService } from "./auth.service.js";
import { ApiError } from "../api-error.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { hashIdentity, hashToken } from "./tokens.js";

export function isDeletedEmail(
  db: Readonly<Pick<ServerDatabase, "select">>,
  email: string,
): boolean {
  return (
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.deletedEmailHash, hashToken(email)))
      .get() !== undefined
  );
}

export function assertOidcIdentityAvailable(
  db: Readonly<Pick<ServerDatabase, "select">>,
  identity: Readonly<IdentityClaims>,
): void {
  const tombstone = db
    .select({ identityHash: authIdentityTombstones.identityHash })
    .from(authIdentityTombstones)
    .where(eq(authIdentityTombstones.identityHash, hashIdentity(identity.iss, identity.sub)))
    .get();

  if (tombstone !== undefined || isDeletedEmail(db, identity.email)) throw invalidOidcLogin();
}

export function resolveOidcUser(
  db: Readonly<Pick<ServerDatabase, "select" | "insert">>,
  auth: Readonly<Pick<AuthService, "currentUser">>,
  identity: Readonly<IdentityClaims>,
  nowMs: number,
): string {
  const existing = db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.issuer, identity.iss), eq(authIdentities.subject, identity.sub)))
    .get();

  if (existing !== undefined) {
    auth.currentUser(existing.userId);

    return existing.userId;
  }

  assertOidcIdentityAvailable(db, identity);

  if (db.select().from(users).where(eq(users.email, identity.email)).get() !== undefined) {
    throw new ApiError(409, "identity_conflict", "existing account ownership must be proven");
  }

  const userId = crypto.randomUUID();
  db.insert(users).values({ id: userId, email: identity.email, createdAt: nowMs }).run();
  db.insert(authIdentities).values({ issuer: identity.iss, subject: identity.sub, userId }).run();

  return userId;
}
