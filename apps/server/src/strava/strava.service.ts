import { Inject, Injectable } from "@nestjs/common";
import type { StravaStatus } from "@voltonaut/shared";
import { SERVER_CONFIG, CLOCK } from "../config.module.js";
import type { ServerConfig, Clock } from "../config.module.js";
import { createToken, hashToken } from "../auth/tokens.js";
import { StravaProvider } from "./strava.provider.js";
import { StravaStore } from "./strava.store.js";
import { stravaCallbackUrl, stravaBinding, stravaCookie } from "./strava.browser.js";
import { decryptTokens, encryptTokens } from "./strava.crypto.js";

@Injectable()
export class StravaService {
  public constructor(
    @Inject(StravaStore) private readonly store: Readonly<StravaStore>,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(StravaProvider) private readonly provider: Readonly<StravaProvider>,
  ) {}

  public status(userId: string): StravaStatus {
    if (this.config.strava.mode === "disabled") return { status: "disabled" };
    const row = this.store.connection(userId);

    if (row === undefined) return { status: "disconnected" };

    if (row.status === "revocation_pending") return { status: "revocation_pending" };

    try {
      decryptTokens(row.encryptedTokens, this.config.strava.tokenKey, userId, row.athleteId);
    } catch {
      return { status: "credentials_unavailable" };
    }

    if (row.status === "pending") {
      if (row.confirmBy === null || row.confirmBy <= this.clock.nowMs())
        return { status: "confirmation_expired" };

      return { status: "pending", confirmBy: new Date(row.confirmBy).toISOString() };
    }

    return {
      status: "connected",
      athleteId: row.athleteId,
      scope: "activity:write",
      accessExpiresAt: new Date(row.accessExpiresAt).toISOString(),
    };
  }

  public start(userId: string) {
    const config = this.provider.enabledConfig();
    const state = createToken();
    const binding = createToken();
    this.store.start(
      {
        stateHash: hashToken(state),
        userId,
        bindingHash: hashToken(binding),
        expiresAt: this.clock.nowMs() + 300_000,
      },
      this.clock.nowMs(),
    );

    return {
      authorizationUrl: this.provider.authorizationUrl(state),
      cookie: stravaCookie(binding, config.redirectUri.startsWith("https:")),
    };
  }

  public async callback(originalUrl: string, cookie: string | undefined): Promise<string> {
    const config = this.provider.enabledConfig();
    const callback = stravaCallbackUrl(originalUrl, config.redirectUri);

    const row = this.store.claim(
      hashToken(callback.state),
      hashToken(stravaBinding(cookie)),
      this.clock.nowMs(),
    );

    try {
      const grant = await this.provider.exchange(callback.authorization(), this.clock.nowMs());
      const handoff = createToken();
      this.store.pending(
        row.stateHash,
        {
          userId: row.userId,
          athleteId: grant.athleteId,
          status: "pending",
          encryptedTokens: encryptTokens(
            grant.tokens,
            config.tokenKey,
            row.userId,
            grant.athleteId,
          ),
          accessExpiresAt: grant.accessExpiresAt,
          scope: "activity:write",
          handoffHash: hashToken(handoff),
          bindingHash: row.bindingHash,
          confirmBy: this.clock.nowMs() + 60_000,
        },
        this.clock.nowMs(),
      );
      const finish = new URL("/strava/finish", this.config.clientOrigin);
      finish.searchParams.set("code", handoff);

      return finish.href;
    } finally {
      this.store.releaseTransaction(row.stateHash);
    }
  }

  public confirm(userId: string, code: string, cookie: string | undefined): StravaStatus {
    const config = this.provider.enabledConfig();
    this.store.confirm(
      userId,
      hashToken(code),
      hashToken(stravaBinding(cookie)),
      this.clock.nowMs(),
      config.tokenKey,
    );

    return this.status(userId);
  }

  public async disconnect(userId: string): Promise<StravaStatus> {
    const config = this.provider.enabledConfig();
    const row = this.store.blockAndClaimRevocation(userId, this.clock.nowMs());

    if (row === undefined) return this.status(userId);

    try {
      const tokens = decryptTokens(row.encryptedTokens, config.tokenKey, userId, row.athleteId);

      if (await this.provider.revoke(tokens.refreshToken)) this.store.revoked(row);
    } catch {
      return { status: "revocation_pending" };
    } finally {
      this.store.releaseRevocation(row);
    }

    return this.status(userId);
  }
}
