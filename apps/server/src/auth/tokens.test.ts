import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { hashDeletedEmail, hashIdentity, hashToken } from "./tokens.js";

const key = "11".repeat(32);

it("keys deletion tombstones with HMAC while session tokens retain plain SHA-256", () => {
  const email = "rider@example.com";
  const issuer = "https://identity.example";
  const subject = "subject";
  const identity = JSON.stringify([issuer, subject]);

  expect(hashDeletedEmail(key, email)).toBe(
    createHmac("sha256", key)
      .update("email\0" + email)
      .digest("hex"),
  );
  expect(hashIdentity(key, issuer, subject)).toBe(
    createHmac("sha256", key)
      .update("identity\0" + identity)
      .digest("hex"),
  );
  expect(hashDeletedEmail(key, email)).not.toBe(hashToken(email));
  expect(hashIdentity(key, issuer, subject)).not.toBe(hashToken(identity));
  expect(hashDeletedEmail("22".repeat(32), email)).not.toBe(hashDeletedEmail(key, email));
  expect(hashToken("opaque-session")).toMatch(/^[a-f0-9]{64}$/u);
});
