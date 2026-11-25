import { eq } from "drizzle-orm";
import type { IdentityClaims } from "./oidc-client.js";
import { invalidOidcLogin } from "./oidc-cookie.js";
import { authIdentityTombstones } from "./auth.schema.js";
import { isDeletedEmail } from "./auth.service.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { hashIdentity } from "./tokens.js";

export function assertIdentityNotTombstoned(
  db: Readonly<Pick<ServerDatabase, "select">>,
  hmacKey: string,
  issuer: string,
  subject: string,
): void {
  const tombstone = db
    .select({ identityHash: authIdentityTombstones.identityHash })
    .from(authIdentityTombstones)
    .where(eq(authIdentityTombstones.identityHash, hashIdentity(hmacKey, issuer, subject)))
    .get();

  if (tombstone !== undefined) throw invalidOidcLogin();
}

export function assertOidcIdentityAvailable(
  db: Readonly<Pick<ServerDatabase, "select">>,
  hmacKey: string,
  identity: Readonly<IdentityClaims>,
): void {
  assertIdentityNotTombstoned(db, hmacKey, identity.iss, identity.sub);

  if (isDeletedEmail(db, hmacKey, identity.email)) throw invalidOidcLogin();
}
