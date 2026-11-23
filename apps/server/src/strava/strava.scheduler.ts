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
import { StravaService } from "./strava.service.js";
import { StravaAuthorization } from "./strava.authorization.js";

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
    @Inject(StravaAuthorization) private readonly authorization: Readonly<StravaAuthorization>,
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

    if (!this.#shutdown.signal.aborted) await this.authorization.tick(this.signal());
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

  private async submit(job: OwnedDelivery): Promise<void> {
    const ready = await this.authorization.ready(job.userId, this.signal());

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
    const token = this.authorization.accessToken(work);
    const requestedAtMs = this.clock.nowMs();
    const rate = this.rates.reserve("upload", requestedAtMs);

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
        this.rates.observe(headers, status, requestedAtMs, this.clock.nowMs(), "upload");
      },
    });

    this.jobs.submitted(dispatched, result, this.clock.nowMs());

    if (result.kind === "refused" && result.reason === "authorization")
      this.credentials.requestAuthorizationCheck(work);
  }

  private async poll(job: OwnedDelivery): Promise<void> {
    const work = (await this.authorization.ready(job.userId, this.signal()))
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
      const token = this.authorization.accessToken(work);
      const requestedAtMs = this.clock.nowMs();

      if (this.rates.reserve("poll", requestedAtMs).kind === "wait") return;

      const result = await this.provider.poll({
        accessToken: token,
        receipt: current.progress.receipt,
        signal: this.signal(),
        onHeaders: (headers, status) => {
          this.rates.observe(headers, status, requestedAtMs, this.clock.nowMs(), "poll");
        },
      });

      this.jobs.pollResult(
        current,
        result.kind === "observed" ? result.state : result,
        this.clock.nowMs(),
      );

      if (result.kind === "deferred" && result.reason === "authorization")
        this.credentials.requestAuthorizationCheck(work);
    } finally {
      this.credentials.releaseWork(work);
    }
  }
}
