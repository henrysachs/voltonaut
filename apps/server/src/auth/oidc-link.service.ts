import { Inject, Injectable } from "@nestjs/common";
import type { LinkedIdentitiesResponse } from "@voltonaut/shared";
import { SERVER_CONFIG, CLOCK } from "../config.module.js";
import type { ServerConfig, Clock } from "../config.module.js";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { ApiError } from "../api-error.js";
import type { SessionPrincipal } from "./auth-request.js";
import { invalidOidcLogin, oidcBrowserBinding, oidcCookieSecure } from "./oidc-cookie.js";
import { identityIssuersOf, linkIdentity, takeLinkHandoff } from "./oidc-link-store.js";

/**
 * Completes explicit account links and lists the account's login identities. A link needs the
 * signed-in session that started it, a fresh provider login (the one-time link handoff) and the
 * same browser binding; nothing is ever linked or merged by email.
 */
@Injectable()
export class OidcLinkService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public complete(
    code: string,
    cookie: string | undefined,
    session: Readonly<SessionPrincipal>,
  ): LinkedIdentitiesResponse {
    if (this.config.auth.mode !== "oidc")
      throw new ApiError(404, "not_found", "login method unavailable");
    const secure = oidcCookieSecure(this.config.auth.providers.map((p) => p.redirectUri));
    const binding = oidcBrowserBinding(cookie, secure);
    const handoff = takeLinkHandoff(this.db, { code, binding }, this.clock.nowMs());

    // A logged-out, expired or switched session fails here: the handoff stays bound to the exact
    // account and session that started the link, and it is consumed on the first attempt.
    if (
      handoff === undefined ||
      handoff.userId !== session.userId ||
      handoff.sessionHash !== session.sessionTokenHash
    )
      throw invalidOidcLogin();

    linkIdentity(this.db, handoff, this.config.auth.tombstoneHmacKey);

    return this.identities(session.userId);
  }

  /** Link requests carry a bearer session and a cookie; only the canonical web origin may send them. */
  public requireClientOrigin(origin: string | undefined): void {
    if (origin !== this.config.clientOrigin)
      throw new ApiError(401, "invalid_oidc_login", "login origin mismatch");
  }

  public identities(userId: string): LinkedIdentitiesResponse {
    const providers = this.config.auth.mode === "oidc" ? this.config.auth.providers : [];

    // Configured providers in their configured order, then logins of removed providers.
    const issuers = identityIssuersOf(this.db, userId);
    const known = providers.filter((provider) => issuers.includes(provider.issuer));
    const unknown = issuers.filter((issuer) => !providers.some((p) => p.issuer === issuer));

    return {
      identities: [
        ...known.map((provider) => ({
          providerId: provider.id,
          displayName: provider.displayName,
        })),
        ...unknown.map((issuer) => ({ providerId: null, displayName: new URL(issuer).host })),
      ],
    };
  }
}
