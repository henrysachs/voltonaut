import { Inject, Injectable } from "@nestjs/common";
import { CLOCK } from "../config.module.js";
import type { Clock } from "../config.module.js";
import { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaConnection } from "./strava.store.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { StravaProvider } from "./strava.provider.js";
import { decryptTokens, encryptTokens } from "./strava.crypto.js";

/** Owns access-token readiness: decrypting the current token and coordinated refresh. */
@Injectable()
export class StravaAuthorization {
  public constructor(
    @Inject(StravaCredentialStore) private readonly credentials: Readonly<StravaCredentialStore>,
    @Inject(StravaDeliveryStore) private readonly jobs: Readonly<StravaDeliveryStore>,
    @Inject(StravaProvider) private readonly provider: Readonly<StravaProvider>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public accessToken(row: StravaConnection): string {
    return decryptTokens(
      row.encryptedTokens,
      this.provider.enabledConfig().tokenKey,
      row.userId,
      row.athleteId,
    ).accessToken;
  }

  public async ready(
    userId: string,
    signal: Readonly<AbortSignal>,
    force = false,
    generation?: string,
  ): Promise<boolean> {
    const row = this.credentials.connection(userId);

    if (
      row === undefined ||
      row.status !== "connected" ||
      (generation !== undefined && generation !== row.generation)
    )
      return false;

    if (!force && row.accessExpiresAt > this.clock.nowMs() + 5000)
      return row.credentialState === "available";
    const work = this.credentials.claimWork(userId, "refresh", this.clock.nowMs());

    if (work === undefined) return false;

    try {
      const config = this.provider.enabledConfig();
      const tokens = decryptTokens(work.encryptedTokens, config.tokenKey, userId, work.athleteId);
      const result = await this.provider.refresh(tokens.refreshToken, this.clock.nowMs(), signal);

      const applied = this.saveRefresh(work, result);

      if (applied && result.kind !== "refreshed")
        this.jobs.stop(userId, "credentials", this.clock.nowMs(), work.generation);

      return applied && result.kind === "refreshed";
    } catch {
      if (this.credentials.finishRefresh(work, { kind: "unknown" }))
        this.jobs.stop(userId, "credentials", this.clock.nowMs(), work.generation);

      return false;
    }
  }

  private saveRefresh(
    work: StravaConnection,
    result: Awaited<ReturnType<StravaProvider["refresh"]>>,
  ): boolean {
    return this.credentials.finishRefresh(
      work,
      result.kind === "refreshed"
        ? {
            kind: "refreshed",
            encryptedTokens: encryptTokens(
              result.tokens,
              this.provider.enabledConfig().tokenKey,
              work.userId,
              work.athleteId,
            ),
            accessExpiresAt: result.accessExpiresAt,
          }
        : result,
    );
  }
}

export const STRAVA_AUTHORIZATION_PROVIDERS = [
  StravaCredentialStore,
  StravaAuthorizationStore,
  StravaAuthorization,
];
