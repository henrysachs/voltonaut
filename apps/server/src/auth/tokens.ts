import { createHash, randomBytes } from "node:crypto";

/** Random opaque token, base64url-encoded, at least 32 bytes of entropy. */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the SHA-256 hash of a token is ever stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Pseudonymous tombstone for an external identity, without retaining issuer/subject. */
export function hashIdentity(issuer: string, subject: string): string {
  return hashToken(JSON.stringify([issuer, subject]));
}

export function deletedAccountEmail(userId: string): string {
  return `deleted+${userId}@voltonaut.invalid`;
}
