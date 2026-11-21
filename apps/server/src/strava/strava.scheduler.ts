import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { CLOCK } from "../config.module.js";
import type { Clock } from "../config.module.js";
import { StravaDeliveryService } from "./strava.delivery.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import type { OwnedDelivery } from "./strava.delivery-state.js";
import { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaConnection } from "./strava.credential-store.js";
import { StravaProvider } from "./strava.provider.js";
import { StravaRateStore } from "./strava.rate-store.js";
import { decryptTokens, encryptTokens } from "./strava.crypto.js";
import { StravaService } from "./strava.service.js";

@Injectable()
export class StravaScheduler implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  readonly #shutdown = new AbortController();
  readonly #logger = new Logger(StravaScheduler.name);
  public constructor(
    @Inject(StravaDeliveryService) private readonly deliveries: Readonly<StravaDeliveryService>,
    @Inject(StravaDeliveryStore) private readonly jobs: Readonly<StravaDeliveryStore>,
    @Inject(StravaCredentialStore) private readonly credentials: Readonly<StravaCredentialStore>,
    @Inject(StravaProvider) private readonly provider: Readonly<StravaProvider>,
    @Inject(StravaRateStore) private readonly rates: Readonly<StravaRateStore>,
    @Inject(StravaService) private readonly connection: Readonly<StravaService>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public onModuleInit(): void {
    this.schedule();
  }
  public async onModuleDestroy(): Promise<void> {
    this.#shutdown.abort();

    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await this.#running;
  }
  private schedule(): void {
    if (this.#shutdown.signal.aborted) return;
    this.#timer = setTimeout(() => {
      this.#running = this.tick()
        .catch(() => {
          this.#logger.warn({ event: "strava_work_failed" });
        })
        .finally(() => {
          this.schedule();
        });
    }, 1000);
    this.#timer.unref();
  }

  public async tick(): Promise<void> {
    if (this.#shutdown.signal.aborted || this.providerModeDisabled()) return;
    this.jobs.recover(this.clock.nowMs());
    this.credentials.recover(this.clock.nowMs());

    for (const row of this.credentials.pendingRevocations()) {
      if (this.#shutdown.signal.aborted) return;
      // oxlint-disable-next-line no-await-in-loop -- Credential operations must finish before the next bounded job.
      await this.connection.disconnect(row.userId);
    }

    if (this.#shutdown.signal.aborted) return;

    const job = this.jobs.prepare(this.clock.nowMs());

    if (job !== undefined) await this.submit(job);

    if (this.#shutdown.signal.aborted) return;

    const poll = this.jobs.nextPoll(this.clock.nowMs());

    if (poll !== undefined) await this.poll(poll);
  }

  private providerModeDisabled(): boolean {
    try {
      this.provider.enabledConfig();

      return false;
    } catch {
      return true;
    }
  }

  private signal(): AbortSignal {
    return AbortSignal.any([this.#shutdown.signal, AbortSignal.timeout(2000)]);
  }

  private async refreshIfNeeded(userId: string): Promise<boolean> {
    const row = this.credentials.connection(userId);

    if (row === undefined || row.status !== "connected") return false;

    if (row.accessExpiresAt > this.clock.nowMs() + 5000) return row.credentialState === "available";
    const work = this.credentials.claimWork(userId, "refresh", this.clock.nowMs());

    if (work === undefined) return false;

    try {
      const config = this.provider.enabledConfig();
      const tokens = decryptTokens(work.encryptedTokens, config.tokenKey, userId, work.athleteId);

      const result = await this.provider.refresh(
        tokens.refreshToken,
        this.clock.nowMs(),
        this.signal(),
      );

      this.credentials.finishRefresh(
        work,
        result.kind === "refreshed"
          ? {
              kind: "refreshed",
              encryptedTokens: encryptTokens(
                result.tokens,
                config.tokenKey,
                userId,
                work.athleteId,
              ),
              accessExpiresAt: result.accessExpiresAt,
            }
          : result,
      );

      if (result.kind !== "refreshed") this.jobs.stop(userId, "credentials", this.clock.nowMs());

      return result.kind === "refreshed";
    } catch {
      this.credentials.finishRefresh(work, { kind: "unknown" });
      this.jobs.stop(userId, "credentials", this.clock.nowMs());

      return false;
    }
  }

  private accessToken(work: StravaConnection): string {
    return decryptTokens(
      work.encryptedTokens,
      this.provider.enabledConfig().tokenKey,
      work.userId,
      work.athleteId,
    ).accessToken;
  }

  private async submit(job: OwnedDelivery): Promise<void> {
    const ready = await this.refreshIfNeeded(job.userId);

    if (!ready) {
      this.jobs.defer(job, this.clock.nowMs() + 15000);

      return;
    }

    const work = this.credentials.claimWork(job.userId, "submit", this.clock.nowMs());

    if (work === undefined) {
      this.jobs.defer(job, this.clock.nowMs() + 15000);

      return;
    }

    try {
      const source = this.deliveries.source(job.userId, job.rideId);
      const offer = this.deliveries.offer(job.userId, job.rideId);

      if (
        source.kind !== "ready" ||
        offer.kind !== "offer" ||
        JSON.stringify(offer.consent) !== JSON.stringify(job.authority.consent)
      ) {
        this.jobs.stopRide(job, "policy", this.clock.nowMs());

        return;
      }

      await this.dispatch(job, work, source.tcx, offer.consent);
    } finally {
      this.credentials.releaseWork(work);
    }
  }

  private async dispatch(
    job: OwnedDelivery,
    work: StravaConnection,
    tcx: string,
    consent: OwnedDelivery["authority"]["consent"],
  ): Promise<void> {
    const token = this.accessToken(work);
    const requestedAtMs = this.clock.nowMs();
    const rate = this.rates.reserve(false, requestedAtMs);

    if (rate.kind === "wait") {
      this.jobs.defer(job, rate.untilMs);

      return;
    }

    const dispatched = this.jobs.dispatch(job, work, consent, this.clock.nowMs());

    if (dispatched === undefined) return;

    const result = await this.provider.submit({
      accessToken: token,
      tcx,
      externalId: `voltonaut-${job.rideId}.tcx`,
      signal: this.signal(),
      onHeaders: (headers, status) => {
        this.rates.observe(headers, status, requestedAtMs, this.clock.nowMs(), false);
      },
    });

    this.jobs.submitted(dispatched, result, this.clock.nowMs());

    if (
      result.kind === "refused" &&
      result.reason === "authorization" &&
      this.credentials.credentialFailure(work)
    )
      this.jobs.stop(job.userId, "credentials", this.clock.nowMs());
  }

  private async poll(job: OwnedDelivery): Promise<void> {
    const work = (await this.refreshIfNeeded(job.userId))
      ? this.credentials.claimWork(job.userId, "poll", this.clock.nowMs())
      : undefined;

    if (work === undefined) {
      this.jobs.deferPoll(job, this.clock.nowMs() + 15000);

      return;
    }

    try {
      const current = this.jobs.own(job.userId, job.rideId);

      if (
        current?.authority.kind !== "consented" ||
        current.progress.kind !== "processing" ||
        current.progress.nextPollAtMs > this.clock.nowMs()
      )
        return;
      const token = this.accessToken(work);
      const requestedAtMs = this.clock.nowMs();

      if (this.rates.reserve(true, requestedAtMs).kind === "wait") return;

      const result = await this.provider.poll({
        accessToken: token,
        receipt: current.progress.receipt,
        signal: this.signal(),
        onHeaders: (headers, status) => {
          this.rates.observe(headers, status, requestedAtMs, this.clock.nowMs(), true);
        },
      });

      this.jobs.pollResult(
        current,
        result.kind === "observed" ? result.state : result,
        this.clock.nowMs(),
      );

      if (
        result.kind === "deferred" &&
        result.reason === "authorization" &&
        this.credentials.credentialFailure(work)
      )
        this.jobs.stop(job.userId, "credentials", this.clock.nowMs());
    } finally {
      this.credentials.releaseWork(work);
    }
  }
}
