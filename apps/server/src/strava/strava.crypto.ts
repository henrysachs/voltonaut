import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

export const StravaTokensSchema = z
  .object({
    accessToken: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[\u0021-\u007E]+$/u),
    refreshToken: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[\u0021-\u007E]+$/u),
  })
  .strict();

export type StravaTokens = z.infer<typeof StravaTokensSchema>;

const EnvelopeSchema = z
  .object({
    keyId: z.literal("1"),
    nonce: z.string().regex(/^[a-f0-9]{24}$/u),
    tag: z.string().regex(/^[a-f0-9]{32}$/u),
    ciphertext: z
      .string()
      .regex(/^(?:[a-f0-9]{2})+$/u)
      .max(40_000),
  })
  .strict();

function aad(userId: string, athleteId: string): Buffer {
  return Buffer.from(JSON.stringify(["voltonaut-strava", "1", userId, athleteId]));
}

export function encryptTokens(
  tokens: StravaTokens,
  key: string,
  userId: string,
  athleteId: string,
): string {
  const nonce = randomBytes(12);

  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, /^[a-f0-9]{64}$/u.test(key) ? "hex" : "base64"),
    nonce,
  );

  cipher.setAAD(aad(userId, athleteId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);

  return JSON.stringify({
    keyId: "1",
    nonce: nonce.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  });
}

export function decryptTokens(
  encrypted: string,
  key: string,
  userId: string,
  athleteId: string,
): StravaTokens {
  const envelope = EnvelopeSchema.parse(JSON.parse(encrypted));

  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, /^[a-f0-9]{64}$/u.test(key) ? "hex" : "base64"),
    Buffer.from(envelope.nonce, "hex"),
  );

  cipher.setAAD(aad(userId, athleteId));
  cipher.setAuthTag(Buffer.from(envelope.tag, "hex"));

  const plaintext = Buffer.concat([
    cipher.update(Buffer.from(envelope.ciphertext, "hex")),
    cipher.final(),
  ]);

  return StravaTokensSchema.parse(JSON.parse(plaintext.toString("utf8")));
}
