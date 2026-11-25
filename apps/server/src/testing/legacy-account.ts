import type { OidcProviderConfig } from "../oidc-config.js";
import { hashToken } from "../auth/tokens.js";
import { seedOwners, type SeedDatabase } from "./migration-harness.spec.js";

export const LEGACY_TEST_PROVIDER: OidcProviderConfig = {
  id: "test",
  displayName: "Test",
  issuer: "https://identity.example",
  clientId: "test",
  clientSecret: "test-secret",
  redirectUri: "https://api.example/v1/auth/oidc/test/callback",
  scopes: ["openid", "email"],
  requireEmailVerified: true,
  idTokenAlg: "RS256",
};

/** Seeds a magic-link account with an unused login token and a live session at any tag. */
export function seedLegacySession(db: SeedDatabase, sessionToken: string): void {
  seedOwners(db, [{ id: "legacy-user", email: "legacy@example.com" }]);
  db.$client
    .prepare(
      "INSERT INTO login_tokens (token_hash, email, expires_at, used_at) VALUES ('legacy-login', 'legacy@example.com', 9999999999999, NULL)",
    )
    .run();
  db.$client
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, 'legacy-user', 0, 0, 9999999999999, NULL)",
    )
    .run(hashToken(sessionToken));
}
