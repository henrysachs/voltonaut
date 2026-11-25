import { Inject, Injectable } from "@nestjs/common";
import { CLOCK } from "../config.module.js";
import type { Clock } from "../config.module.js";
import { StravaDeliveryService } from "./strava.delivery.js";
import { StravaDeliveryStore } from "./strava.delivery-store.js";
import type { OwnedDelivery } from "./strava.delivery-state.js";
import { StravaCredentialStore } from "./strava.credential-store.js";
import type { StravaConnection } from "./strava.credential-store.js";
import { StravaAuthorization } from "./strava.authorization.js";
import { StravaAuthorizationStore } from "./strava.authorization-store.js";
import { StravaProvider } from "./strava.provider.js";
import { StravaRateStore } from "./strava.rate-store.js";
import type { StravaRatePurpose } from "./strava.rate-store.js";

const RETRY_MS = 15000;
const HINT_COOLDOWN_MS = 60000;
const PROVIDER_TIMEOUT_MS = 2000;

type Reservation =
  | { readonly kind: "wait"; readonly untilMs: number }
  | {
      readonly kind: "reserved";
      readonly requestedAtMs: number;
      readonly onHeaders: (headers: Readonly<Headers>, status: number) => void;
      readonly release: () => void;
    };

type Leased<T> = { readonly kind: "claimed"; readonly value: T } | { readonly kind: "busy" };

/**
 * Runs one due Strava step end to end: credential lease, refresh, rate reservation and
 * settlement, dispatch commit, provider call, outcome recording and lease release.
 */
@Injectable()
export class StravaDeliveryStep {
  public constructor(
    @Inject(StravaDeliveryService) private readonly deliveries: Readonly<StravaDeliveryService>,
    @Inject(StravaDeliveryStore) private readonly jobs: Readonly<StravaDeliveryStore>,
    @Inject(StravaCredentialStore) private readonly credentials: Readonly<StravaCredentialStore>,
    @Inject(StravaAuthorization) private readonly authorization: Readonly<StravaAuthorization>,
    @Inject(StravaAuthorizationStore) private readonly hints: Readonly<StravaAuthorizationStore>,
    @Inject(StravaProvider) private readonly provider: Readonly<StravaProvider>,
    @Inject(StravaRateStore) private readonly rates: Readonly<StravaRateStore>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public enabled(): boolean {
    try {
      this.provider.enabledConfig();

      return true;
    } catch {
      return false;
    }
  }

  public recover(): void {
    this.jobs.recover(this.clock.nowMs());
    this.credentials.recover(this.clock.nowMs());
  }

  public pendingRevocations(): readonly string[] {
    return this.credentials.pendingRevocations().map((row) => row.userId);
  }

  public async submitNext(shutdown: Readonly<AbortSignal>): Promise<void> {
    const job = this.jobs.prepare(this.clock.nowMs());

    if (job === undefined) return;
    const ready = await this.authorization.ready(job.userId, this.deadline(shutdown));

    const lease = ready
      ? await this.leased(job.userId, "submit", (work) => this.upload(job, work, shutdown))
      : undefined;

    if (lease?.kind !== "claimed") this.jobs.defer(job, this.clock.nowMs() + RETRY_MS);
  }

  public async pollNext(shutdown: Readonly<AbortSignal>): Promise<void> {
    const job = this.jobs.nextPoll(this.clock.nowMs());

    if (job === undefined) return;
    const ready = await this.authorization.ready(job.userId, this.deadline(shutdown));

    const lease = ready
      ? await this.leased(job.userId, "poll", (work) => this.observe(job, work, shutdown))
      : undefined;

    if (lease?.kind !== "claimed") this.jobs.deferPoll(job, this.clock.nowMs() + RETRY_MS);
  }

  public async checkNextHint(shutdown: Readonly<AbortSignal>): Promise<void> {
    const candidate = this.hints.next(this.clock.nowMs());

    if (candidate === undefined) return;
    const signal = this.deadline(shutdown);
    const { userId, generation } = candidate;

    const ready = await this.authorization.ready(userId, signal, false, generation);

    if (!ready) return;

    const proof = await this.leased(userId, "poll", (work) =>
      work.generation === generation ? this.verify(work, signal) : Promise.resolve(false),
    );

    if (proof.kind === "claimed" && proof.value)
      await this.authorization.ready(userId, signal, true, generation);
  }

  private async upload(
    job: OwnedDelivery,
    work: StravaConnection,
    shutdown: Readonly<AbortSignal>,
  ): Promise<void> {
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

    const accessToken = this.authorization.accessToken(work);
    const rate = this.reserve("upload");

    if (rate.kind === "wait") {
      this.jobs.defer(job, rate.untilMs);

      return;
    }

    const attempt = this.jobs.dispatch(job, work, offer.consent, this.clock.nowMs());

    if (attempt === undefined) {
      rate.release();

      return;
    }

    const result = await this.provider.submit({
      attempt,
      accessToken,
      tcx: source.tcx,
      signal: this.deadline(shutdown),
      onHeaders: rate.onHeaders,
    });

    this.jobs.submitted(attempt, result, this.clock.nowMs());

    if (result.kind === "refused" && result.reason === "authorization")
      this.credentials.requestAuthorizationCheck(work);
  }

  private async observe(
    job: OwnedDelivery,
    work: StravaConnection,
    shutdown: Readonly<AbortSignal>,
  ): Promise<void> {
    const current = this.jobs.own(job.userId, job.rideId);

    if (
      current?.authority.kind !== "consented" ||
      current.progress.kind !== "processing" ||
      current.progress.nextPollAtMs > this.clock.nowMs()
    )
      return;
    const accessToken = this.authorization.accessToken(work);
    const rate = this.reserve("poll");

    if (rate.kind === "wait") return;

    const result = await this.provider.poll({
      accessToken,
      receipt: current.progress.receipt,
      signal: this.deadline(shutdown),
      onHeaders: rate.onHeaders,
    });

    this.jobs.pollResult(
      current,
      result.kind === "observed" ? result.state : result,
      this.clock.nowMs(),
    );

    if (result.kind === "deferred" && result.reason === "authorization")
      this.credentials.requestAuthorizationCheck(work);
  }

  /** Returns whether the provider rejected the access token of this lease. */
  private async verify(work: StravaConnection, signal: Readonly<AbortSignal>): Promise<boolean> {
    const accessToken = this.authorization.accessToken(work);
    const rate = this.reserve("authorization_hint");

    if (rate.kind === "wait") {
      this.hints.defer(work, rate.untilMs, false);

      return false;
    }

    this.hints.defer(work, rate.requestedAtMs + HINT_COOLDOWN_MS, false);

    const result = await this.provider.verifyAuthorization({
      athleteId: work.athleteId,
      accessToken,
      signal,
      onHeaders: rate.onHeaders,
    });

    this.hints.defer(work, this.clock.nowMs() + HINT_COOLDOWN_MS, result.kind === "valid");

    return result.kind === "deferred" && result.unauthorized;
  }

  private async leased<T>(
    userId: string,
    operation: "submit" | "poll",
    run: (work: StravaConnection) => Promise<T>,
  ): Promise<Leased<T>> {
    const work = this.credentials.claimWork(userId, operation, this.clock.nowMs());

    if (work === undefined) return { kind: "busy" };

    try {
      return { kind: "claimed", value: await run(work) };
    } finally {
      this.credentials.releaseWork(work);
    }
  }

  /** A reserved request either reports its headers or, when it was never sent, is released. */
  private reserve(purpose: StravaRatePurpose): Reservation {
    const requestedAtMs = this.clock.nowMs();
    const rate = this.rates.reserve(purpose, requestedAtMs);

    if (rate.kind === "wait") return rate;

    return {
      kind: "reserved",
      requestedAtMs,
      onHeaders: (headers, status) => {
        this.rates.observe(headers, status, requestedAtMs, this.clock.nowMs(), purpose);
      },
      release: () => {
        this.rates.release(purpose, requestedAtMs, this.clock.nowMs());
      },
    };
  }

  private deadline(shutdown: Readonly<AbortSignal>): AbortSignal {
    return AbortSignal.any([shutdown, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]);
  }
}
