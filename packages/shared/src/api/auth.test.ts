import { expect, it } from "vitest";
import {
  MagicLinkRequestSchema,
  SessionRequestSchema,
  SessionResponseSchema,
  UserSchema,
} from "./auth.js";
import { ErrorEnvelopeSchema, errorEnvelope } from "./errors.js";

it("validates auth payloads without changing E3 contracts", () => {
  const session = SessionResponseSchema.parse({
    sessionToken: "a-public-contract-example-not-a-real-session-token",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "rider@example.com",
      createdAt: "2026-11-20T12:00:00.000Z",
    },
  });

  expect(UserSchema.parse(session.user).email).toBe("rider@example.com");
  expect(MagicLinkRequestSchema.parse({ email: " Rider@Example.com " })).toEqual({
    email: "rider@example.com",
  });
  expect(SessionRequestSchema.safeParse({ loginToken: "" }).success).toBe(false);
  expect(SessionRequestSchema.safeParse({ loginToken: "x".repeat(257) }).success).toBe(false);
  expect(ErrorEnvelopeSchema.parse(errorEnvelope("unauthorized", "missing session"))).toEqual({
    error: { code: "unauthorized", message: "missing session" },
  });
});
