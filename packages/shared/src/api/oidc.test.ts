import { expect, it } from "vitest";
import { AuthConfigResponseSchema, OidcExchangeRequestSchema, MeResponseSchema } from "./auth.js";

it("limits public capabilities to finite modes without secret metadata", () => {
  for (const mode of ["disabled", "oidc", "magic-link"]) {
    expect(AuthConfigResponseSchema.parse({ mode })).toEqual({ mode });
  }

  expect(AuthConfigResponseSchema.safeParse({ mode: "oidc", clientSecret: "secret" }).success).toBe(
    false,
  );
  expect(AuthConfigResponseSchema.safeParse({ mode: "fallback" }).success).toBe(false);
});

it("accepts only an opaque handoff and a concrete authenticated user response", () => {
  expect(OidcExchangeRequestSchema.parse({ code: "a".repeat(43) })).toEqual({
    code: "a".repeat(43),
  });

  for (const body of [
    { code: "short" },
    { code: "a".repeat(43), returnTo: "https://evil.example" },
    {},
  ]) {
    expect(OidcExchangeRequestSchema.safeParse(body).success).toBe(false);
  }

  expect(
    MeResponseSchema.safeParse({
      user: {
        id: crypto.randomUUID(),
        email: "rider@example.com",
        createdAt: new Date(0).toISOString(),
      },
    }).success,
  ).toBe(true);
});
