import { eq } from "drizzle-orm";
import type { IdentityClaims } from "./oidc-client.js";
import { invalidOidcLogin } from "./oidc-cookie.js";
import { authIdentityTombstones, users } from "./auth.schema.js";
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

export function assertIdentityNotTombstoned(
  db: Readonly<Pick<ServerDatabase, "select">>,
  issuer: string,
  subject: string,
): void {
  const tombstone = db
    .select({ identityHash: authIdentityTombstones.identityHash })
    .from(authIdentityTombstones)
    .where(eq(authIdentityTombstones.identityHash, hashIdentity(issuer, subject)))
    .get();

  if (tombstone !== undefined) throw invalidOidcLogin();
}

export function assertOidcIdentityAvailable(
  db: Readonly<Pick<ServerDatabase, "select">>,
  identity: Readonly<IdentityClaims>,
): void {
  assertIdentityNotTombstoned(db, identity.iss, identity.sub);

  if (isDeletedEmail(db, identity.email)) throw invalidOidcLogin();
}
