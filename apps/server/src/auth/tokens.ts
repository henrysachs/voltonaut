import { createHash, createHmac, randomBytes } from "node:crypto";

/** Random opaque token, base64url-encoded, at least 32 bytes of entropy. */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the SHA-256 hash of a token is ever stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hmacTombstone(key: string, domain: string, value: string): string {
  return createHmac("sha256", key).update(`${domain}\0${value}`).digest("hex");
}

/** Server-keyed pseudonymous email tombstone; never used for bearer or login tokens. */
export function hashDeletedEmail(key: string, email: string): string {
  return hmacTombstone(key, "email", email);
}

/** Server-keyed external identity tombstone, without retaining issuer/subject. */
export function hashIdentity(key: string, issuer: string, subject: string): string {
  return hmacTombstone(key, "identity", JSON.stringify([issuer, subject]));
}

export function deletedAccountEmail(userId: string): string {
  return `deleted+${userId}@voltonaut.invalid`;
}
