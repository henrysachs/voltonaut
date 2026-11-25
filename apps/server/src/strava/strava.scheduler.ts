import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { StravaService } from "./strava.service.js";
import { StravaDeliveryStep } from "./strava.delivery-step.js";

@Injectable()
export class StravaScheduler implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  readonly #shutdown = new AbortController();
  readonly #logger = new Logger(StravaScheduler.name);
  public constructor(
    @Inject(StravaDeliveryStep) private readonly step: Readonly<StravaDeliveryStep>,
    @Inject(StravaService) private readonly connection: Readonly<StravaService>,
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
    const shutdown = this.#shutdown.signal;

    if (shutdown.aborted || !this.step.enabled()) return;
    this.step.recover();

    for (const userId of this.step.pendingRevocations()) {
      if (shutdown.aborted) return;
      // oxlint-disable-next-line no-await-in-loop -- Credential operations must finish before the next bounded job.
      await this.connection.disconnect(userId);
    }

    if (shutdown.aborted) return;
    await this.step.submitNext(shutdown);

    if (shutdown.aborted) return;
    await this.step.pollNext(shutdown);

    if (!shutdown.aborted) await this.step.checkNextHint(shutdown);
  }
}

export const STRAVA_SCHEDULER_PROVIDERS = [StravaDeliveryStep, StravaScheduler];
