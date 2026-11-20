import { createHash, randomBytes } from "node:crypto";

/** Random opaque token, base64url-encoded, at least 32 bytes of entropy. */
export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the SHA-256 hash of a token is ever stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
