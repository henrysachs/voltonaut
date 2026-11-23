import { Inject, Injectable } from "@nestjs/common";
import { CLOCK } from "../config.module.js";
import type { Clock } from "../config.module.js";
import { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaConnection } from "./strava.store.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { StravaProvider } from "./strava.provider.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { decryptTokens, encryptTokens } from "./strava.crypto.js";

@Injectable()
export class StravaAuthorization {
  public constructor(
    @Inject(StravaCredentialStore) private readonly credentials: Readonly<StravaCredentialStore>,
    @Inject(StravaDeliveryStore) private readonly jobs: Readonly<StravaDeliveryStore>,
    @Inject(StravaAuthorizationStore) private readonly hints: Readonly<StravaAuthorizationStore>,
    @Inject(StravaProvider) private readonly provider: Readonly<StravaProvider>,
    @Inject(StravaRateStore) private readonly rates: Readonly<StravaRateStore>,
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

  public async tick(signal: Readonly<AbortSignal>): Promise<void> {
    const candidate = this.hints.next(this.clock.nowMs());

    if (candidate === undefined) return;
    const ready = await this.ready(candidate.userId, signal, false, candidate.generation);

    if (!ready) return;
    const work = this.credentials.claimWork(candidate.userId, "poll", this.clock.nowMs());

    if (work === undefined) return;

    if (work.generation !== candidate.generation) {
      this.credentials.releaseWork(work);

      return;
    }

    let unauthorized = false;

    try {
      const requestedAtMs = this.clock.nowMs();
      const purpose = "authorization_hint";
      const rate = this.rates.reserve(purpose, requestedAtMs);

      if (rate.kind === "wait") {
        this.hints.defer(work, rate.untilMs, false);

        return;
      }

      this.hints.defer(work, requestedAtMs + 60000, false);

      const result = await this.provider.verifyAuthorization({
        athleteId: work.athleteId,
        accessToken: this.accessToken(work),
        signal,
        onHeaders: (headers, status) => {
          this.rates.observe(headers, status, requestedAtMs, this.clock.nowMs(), purpose);
        },
      });

      this.hints.defer(work, this.clock.nowMs() + 60000, result.kind === "valid");
      unauthorized = result.kind === "deferred" && result.unauthorized;
    } finally {
      this.credentials.releaseWork(work);
    }

    if (unauthorized) await this.ready(work.userId, signal, true, work.generation);
  }
}

export const STRAVA_AUTHORIZATION_PROVIDERS = [
  StravaCredentialStore,
  StravaAuthorizationStore,
  StravaAuthorization,
];
