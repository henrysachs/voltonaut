/* oxlint-disable eslint/max-classes-per-file -- Only the store that writes the dispatch commit may construct its proof. */
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { StravaProgressSchema } from "@voltonaut/shared";
import type { StravaConsent, StravaProgress } from "@voltonaut/shared";
import { DRIZZLE } from "../database/drizzle.provider.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { STRAVA_TABLES } from "./strava.schema.js";
import type { StravaTables } from "./strava.schema.js";
import type { StravaConnection } from "./strava.store.js";
import { stravaConflict } from "./strava.provider.js";
import type { SubmitResult, ProviderUploadState } from "./strava.upload-provider.js";
import {
  parseDelivery,
  observedProgress,
  canDispatch,
  submittedProgress,
} from "./strava.delivery-state.js";
import type { OwnedDelivery, SubmittingDelivery } from "./strava.delivery-state.js";
import { prepareDueDeliveries } from "./strava.delivery-state.js";
import type { DueDeliveryKind } from "./strava.delivery-state.js";

/**
 * Proof that `dispatch` durably committed one upload attempt (ADR-018). The class stays
 * unexported and its ECMAScript-private field makes it nominal, so neither literals nor spread
 * copies type-check as `CommittedAttempt`. Single use relies on the one caller in the step.
 */
class DispatchedAttempt {
  readonly #delivery: SubmittingDelivery;
  public readonly externalId: string;

  public constructor(delivery: SubmittingDelivery) {
    this.#delivery = delivery;
    this.externalId = `voltonaut-${delivery.rideId}.tcx`;
  }

  public get delivery(): SubmittingDelivery {
    return this.#delivery;
  }
}

export type CommittedAttempt = DispatchedAttempt;

@Injectable()
export class StravaDeliveryStore {
  private readonly dueQueries: {
    [Kind in DueDeliveryKind]?: ReturnType<typeof prepareDueDeliveries>;
  } = {};

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle metadata passes unchanged through DI.
    @Inject(STRAVA_TABLES) private readonly tables: StravaTables,
  ) {}

  public own(userId: string, rideId: string): OwnedDelivery | undefined {
    const table = this.tables.deliveries;

    const row = this.db
      .select()
      .from(table)
      .where(and(eq(table.userId, userId), eq(table.rideId, rideId)))
      .get();

    return row === undefined ? undefined : parseDelivery(row);
  }

  public enqueue(userId: string, consent: StravaConsent, nowMs: number): OwnedDelivery {
    return this.db.transaction(
      () => {
        const existing = this.own(userId, consent.rideId);

        if (existing !== undefined) return existing;
        const connection = this.tables.connections;

        const current = this.db
          .select()
          .from(connection)
          .where(eq(connection.userId, userId))
          .get();

        if (
          current === undefined ||
          current.status !== "connected" ||
          current.credentialState !== "available" ||
          current.generation !== consent.connectionGeneration ||
          current.athleteId !== consent.athleteId
        )
          throw stravaConflict();

        const delivery: OwnedDelivery = {
          userId,
          deliveryId: randomUUID(),
          rideId: consent.rideId,
          authority: { kind: "consented", consent, consentedAtMs: nowMs },
          progress: { kind: "queued", notBeforeMs: nowMs },
        };

        this.db
          .insert(this.tables.deliveries)
          .values({
            ...delivery,
            authority: JSON.stringify(delivery.authority),
            progress: JSON.stringify(delivery.progress),
          })
          .run();

        return delivery;
      },
      { behavior: "immediate" },
    );
  }

  public recover(nowMs: number): void {
    for (const delivery of this.due("recover", nowMs)) {
      if (delivery.progress.kind === "submitting" && delivery.progress.leaseUntilMs <= nowMs)
        this.transition(delivery, {
          kind: "submission_unknown",
          attemptId: delivery.progress.attemptId,
          reason: "crash",
        });
    }
  }

  public prepare(nowMs: number): OwnedDelivery | undefined {
    return this.db.transaction(
      (): OwnedDelivery | undefined => {
        this.recover(nowMs);

        const job = this.due("prepare", nowMs)[0];

        const progress: StravaProgress = {
          kind: "preparing",
          owner: randomUUID(),
          leaseUntilMs: nowMs + 10000,
        };

        return job !== undefined && this.transition(job, progress)
          ? { ...job, progress }
          : undefined;
      },
      { behavior: "immediate" },
    );
  }

  public defer(job: OwnedDelivery, notBeforeMs: number): void {
    if (job.progress.kind === "preparing") this.transition(job, { kind: "queued", notBeforeMs });
  }

  public dispatch(
    job: OwnedDelivery,
    work: StravaConnection,
    source: StravaConsent,
    nowMs: number,
  ): CommittedAttempt | undefined {
    return this.db.transaction(
      (): CommittedAttempt | undefined => {
        const table = this.tables.connections;
        const current = this.db.select().from(table).where(eq(table.userId, job.userId)).get();

        const progress: SubmittingDelivery["progress"] = {
          kind: "submitting",
          attemptId: randomUUID(),
          startedAtMs: nowMs,
          leaseUntilMs: nowMs + 10000,
        };

        return canDispatch(job, work, source, current, nowMs) && this.transition(job, progress)
          ? new DispatchedAttempt({ ...job, progress })
          : undefined;
      },
      { behavior: "immediate" },
    );
  }

  public submitted(attempt: CommittedAttempt, result: SubmitResult, nowMs: number): void {
    const job = attempt.delivery;
    const current = this.own(job.userId, job.rideId);

    if (
      current === undefined ||
      (current.progress.kind !== "submitting" && current.progress.kind !== "submission_unknown") ||
      current.progress.attemptId !== job.progress.attemptId
    )
      return;

    this.transition(current, submittedProgress(job.progress.attemptId, result, nowMs));
  }

  public pollResult(
    job: OwnedDelivery,
    state:
      | ProviderUploadState
      | {
          readonly kind: "deferred";
          readonly reason: "authorization" | "rate_limit" | "network" | "protocol";
        },
    nowMs: number,
  ): void {
    if (job.progress.kind !== "processing") return;
    const current = this.own(job.userId, job.rideId);

    if (
      current?.progress.kind !== "processing" ||
      current.progress.receipt.uploadId !== job.progress.receipt.uploadId
    )
      return;
    this.transition(
      current,
      state.kind === "deferred"
        ? { ...current.progress, nextPollAtMs: nowMs + 15000, issue: state.reason }
        : observedProgress(current.progress.receipt, state, nowMs),
    );
  }

  public stop(
    userId: string,
    reason: "disconnect" | "credentials" | "policy",
    nowMs: number,
    generation?: string,
  ): void {
    const table = this.tables.deliveries;
    this.db.transaction(
      () => {
        for (const row of this.db.select().from(table).where(eq(table.userId, userId)).all()) {
          const delivery = parseDelivery(row);

          if (
            generation === undefined ||
            delivery.authority.consent.connectionGeneration === generation
          )
            this.stopRide(delivery, reason, nowMs);
        }
      },
      { behavior: "immediate" },
    );
  }

  public nextPoll(nowMs: number): OwnedDelivery | undefined {
    return this.due("poll", nowMs)[0];
  }

  public deferPoll(job: OwnedDelivery, nextPollAtMs: number): void {
    if (job.authority.kind === "consented" && job.progress.kind === "processing")
      this.transition(job, { ...job.progress, nextPollAtMs });
  }

  private due(kind: DueDeliveryKind, nowMs: number): readonly OwnedDelivery[] {
    return (this.dueQueries[kind] ??= prepareDueDeliveries(this.db, this.tables, kind))
      .all({ nowMs })
      .map((row) => parseDelivery(row));
  }

  public stopRide(
    job: OwnedDelivery,
    reason: "disconnect" | "credentials" | "policy",
    nowMs: number,
  ): void {
    if (job.authority.kind !== "consented") return;
    const table = this.tables.deliveries;
    this.db
      .update(table)
      .set({
        authority: JSON.stringify({
          kind: "stopped",
          consent: job.authority.consent,
          stoppedAtMs: nowMs,
          reason,
        }),
      })
      .where(
        and(
          eq(table.deliveryId, job.deliveryId),
          eq(table.authority, JSON.stringify(job.authority)),
        ),
      )
      .run();
  }

  private transition(job: OwnedDelivery, progress: StravaProgress): boolean {
    const table = this.tables.deliveries;

    return (
      this.db
        .update(table)
        .set({ progress: JSON.stringify(StravaProgressSchema.parse(progress)) })
        .where(
          and(
            eq(table.deliveryId, job.deliveryId),
            eq(table.progress, JSON.stringify(job.progress)),
            eq(table.authority, JSON.stringify(job.authority)),
          ),
        )
        .run().changes === 1
    );
  }
}
