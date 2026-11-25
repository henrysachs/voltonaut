import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { OidcProviderConfig } from "../oidc-config.js";
import type { DatabaseReader } from "./test-app.spec.js";
import { hashToken } from "../auth/tokens.js";

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

export function seedLegacySession(client: DatabaseReader["$client"], sessionToken: string): void {
  client
    .prepare(
      "INSERT INTO users (id, email, created_at, deleted_at) VALUES ('legacy-user', 'legacy@example.com', 0, NULL)",
    )
    .run();
  client
    .prepare(
      "INSERT INTO login_tokens (token_hash, email, expires_at, used_at) VALUES ('legacy-login', 'legacy@example.com', 9999999999999, NULL)",
    )
    .run();
  client
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, 'legacy-user', 0, 0, 9999999999999, NULL)",
    )
    .run(hashToken(sessionToken));
}

export function legacyMigrations(directory: string): string {
  const folder = join(directory, "legacy-migrations");
  const source = new URL("../../drizzle/", import.meta.url);
  mkdirSync(join(folder, "meta"), { recursive: true });

  const journal = z
    .object({
      version: z.string(),
      dialect: z.string(),
      entries: z.array(
        z.object({
          idx: z.number(),
          version: z.string(),
          when: z.number(),
          tag: z.string(),
          breakpoints: z.boolean(),
        }),
      ),
    })
    .parse(JSON.parse(readFileSync(new URL("meta/_journal.json", source), "utf8")));

  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
  );
  copyFileSync(
    new URL("0000_steep_trish_tilby.sql", source),
    join(folder, "0000_steep_trish_tilby.sql"),
  );

  return folder;
}
