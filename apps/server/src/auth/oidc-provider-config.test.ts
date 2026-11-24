import { expect, it } from "vitest";
import { parseServerConfig } from "../config.js";
import { oidcProvidersOf } from "../testing/oidc-providers.spec.js";

const BASE = {
  AUTH_MODE: "oidc",
  OIDC_PROVIDERS: "cloudflare,authentik",
  OIDC_CLOUDFLARE_ISSUER: "https://cf.example/oidc",
  OIDC_CLOUDFLARE_CLIENT_ID: "cf",
  OIDC_CLOUDFLARE_CLIENT_SECRET: "cf-secret",
  OIDC_CLOUDFLARE_REDIRECT_URI: "https://api.example/v1/auth/oidc/cloudflare/callback",
  OIDC_AUTHENTIK_ISSUER: "https://auth.example/application/o/voltonaut/",
  OIDC_AUTHENTIK_CLIENT_ID: "ak",
  OIDC_AUTHENTIK_CLIENT_SECRET: "ak-secret",
  OIDC_AUTHENTIK_REDIRECT_URI: "https://api.example/v1/auth/oidc/authentik/callback",
  DATABASE_PATH: ":memory:",
};

it("parses provider defaults and per-provider overrides", () => {
  const config = parseServerConfig(
    {
      ...BASE,
      OIDC_AUTHENTIK_SCOPES: "openid email profile",
      OIDC_AUTHENTIK_REQUIRE_EMAIL_VERIFIED: "false",
      OIDC_AUTHENTIK_ID_TOKEN_ALG: "ES256",
    },
    "production",
  );

  expect(oidcProvidersOf(config.auth)).toMatchObject([
    {
      id: "cloudflare",
      displayName: "cloudflare",
      scopes: ["openid", "email"],
      requireEmailVerified: true,
      idTokenAlg: "RS256",
    },
    {
      id: "authentik",
      issuer: "https://auth.example/application/o/voltonaut/",
      scopes: ["openid", "email", "profile"],
      requireEmailVerified: false,
      idTokenAlg: "ES256",
    },
  ]);
});

it("treats empty optional values passed by Compose as defaults", () => {
  const config = parseServerConfig(
    {
      ...BASE,
      OIDC_AUTHENTIK_DISPLAY_NAME: "",
      OIDC_AUTHENTIK_SCOPES: "",
      OIDC_AUTHENTIK_REQUIRE_EMAIL_VERIFIED: "",
      OIDC_AUTHENTIK_ID_TOKEN_ALG: "",
    },
    "production",
  );

  expect(oidcProvidersOf(config.auth)[1]).toMatchObject({
    displayName: "authentik",
    scopes: ["openid", "email"],
    requireEmailVerified: true,
    idTokenAlg: "RS256",
  });
});

const AUTHENTIK_CALLBACK = "https://api.example/v1/auth/oidc/authentik/callback";

it.each([
  ["no provider list", { OIDC_PROVIDERS: "" }],
  ["duplicate id", { OIDC_PROVIDERS: "cloudflare,cloudflare" }],
  ["invalid id", { OIDC_PROVIDERS: "cloudflare,Bad_ID" }],
  ["a listed provider without configuration", { OIDC_PROVIDERS: "cloudflare,authentik,extra" }],
  ["a missing secret", { OIDC_AUTHENTIK_CLIENT_SECRET: "" }],
  [
    "a redirect URI of another provider",
    { OIDC_AUTHENTIK_REDIRECT_URI: "https://api.example/v1/auth/oidc/cloudflare/callback" },
  ],
  [
    "the legacy callback path",
    { OIDC_AUTHENTIK_REDIRECT_URI: "https://api.example/v1/auth/oidc/callback" },
  ],
  ["a redirect URI with a query", { OIDC_AUTHENTIK_REDIRECT_URI: `${AUTHENTIK_CALLBACK}?a=b` }],
  ["scopes without openid", { OIDC_AUTHENTIK_SCOPES: "email" }],
  ["an unknown token algorithm", { OIDC_AUTHENTIK_ID_TOKEN_ALG: "none" }],
  ["a non-boolean email policy", { OIDC_AUTHENTIK_REQUIRE_EMAIL_VERIFIED: "maybe" }],
  ["a display name over the public limit", { OIDC_AUTHENTIK_DISPLAY_NAME: "x".repeat(41) }],
  ["an insecure issuer", { OIDC_AUTHENTIK_ISSUER: "http://auth.example/application/o/x/" }],
])(
  "fails startup configuration for %s instead of ignoring it",
  (_name: string, override: Readonly<Record<string, string>>) => {
    expect(() => parseServerConfig({ ...BASE, ...override }, "production")).toThrow(/.+/u);
  },
);

it("ignores configuration of providers that are not listed", () => {
  const config = parseServerConfig(
    { ...BASE, OIDC_PROVIDERS: "authentik", OIDC_CLOUDFLARE_CLIENT_SECRET: "" },
    "production",
  );

  expect(oidcProvidersOf(config.auth).map((provider) => provider.id)).toEqual(["authentik"]);
});
