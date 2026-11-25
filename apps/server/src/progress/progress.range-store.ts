import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  ProgressCheckpointBatchSchema,
  RewardFactsSchema,
  VoltsRideRangeReceiptSchema,
  type ProgressCheckpointBatch,
  type RewardFacts,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import type { SessionPrincipal } from "../auth/auth-request.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import type {
  ProgressConsentRow,
  ProgressTables,
  RideProgressJournalRow,
  RideProgressRangeRow,
} from "./progress.schema.js";
import {
  progressError,
  type ValidatedProgressBatch,
  type ValidatedProgressRange,
} from "./progress.validation.js";

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Validated progress contracts and Zod brands are readonly; the rule cannot resolve these aliases. */
export class ProgressRangeStore {
  private readonly consents: ProgressTables["progressConsents"];
  private readonly journals: ProgressTables["rideProgressJournals"];
  private readonly ranges: ProgressTables["rideProgressRanges"];

  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    tables: ProgressTables,
  ) {
    this.consents = tables.progressConsents;
    this.journals = tables.rideProgressJournals;
    this.ranges = tables.rideProgressRanges;
  }

  public consent(userId: string): ProgressConsentRow | undefined {
    return this.db.select().from(this.consents).where(eq(this.consents.userId, userId)).get();
  }

  public journal(journalId: string): RideProgressJournalRow | undefined {
    return this.db.select().from(this.journals).where(eq(this.journals.journalId, journalId)).get();
  }

  public range(range: ValidatedProgressRange): RideProgressRangeRow | undefined {
    return this.db
      .select()
      .from(this.ranges)
      .where(
        and(
          eq(this.ranges.journalId, range.metadata.journalId),
          eq(this.ranges.startTick, range.startTick),
        ),
      )
      .get();
  }

  public facts(journal: Readonly<RideProgressJournalRow>): RewardFacts {
    try {
      return RewardFactsSchema.parse(JSON.parse(journal.cumulativeFactsJson));
    } catch {
      throw progressError(500, "internal_error", "corrupt progress journal facts");
    }
  }

  public payload(range: Readonly<RideProgressRangeRow>): ProgressCheckpointBatch {
    try {
      return ProgressCheckpointBatchSchema.parse(JSON.parse(range.payloadJson));
    } catch {
      throw progressError(500, "internal_error", "corrupt progress range payload");
    }
  }

  public receipt(range: Readonly<RideProgressRangeRow>): VoltsRideRangeReceipt {
    try {
      const receipt = VoltsRideRangeReceiptSchema.parse(JSON.parse(range.receiptJson));

      if (
        receipt.journalId !== range.journalId ||
        receipt.startTick !== range.startTick ||
        receipt.endTick !== range.endTick
      ) {
        throw new Error("progress range receipt mismatch");
      }

      return receipt;
    } catch {
      throw progressError(500, "internal_error", "corrupt progress range receipt");
    }
  }

  public commit(
    session: Readonly<SessionPrincipal>,
    batch: ValidatedProgressBatch,
    cumulativeFacts: RewardFacts,
    receipt: VoltsRideRangeReceipt,
    payloadHash: string,
    nowMs: number,
  ): void {
    this.insertRange(session, batch, cumulativeFacts, receipt, payloadHash, nowMs);
    this.upsertJournal(session, batch, cumulativeFacts, nowMs);
  }

  private insertRange(
    session: Readonly<SessionPrincipal>,
    batch: ValidatedProgressBatch,
    cumulativeFacts: RewardFacts,
    receipt: VoltsRideRangeReceipt,
    payloadHash: string,
    nowMs: number,
  ): void {
    const range = batch.range;

    this.db
      .insert(this.ranges)
      .values({
        id: randomUUID(),
        journalId: range.metadata.journalId,
        userId: session.userId,
        startTick: range.startTick,
        endTick: range.endTick,
        payloadHash,
        payloadJson: JSON.stringify(batch.payload),
        cumulativeFactsJson: JSON.stringify(cumulativeFacts),
        receiptJson: JSON.stringify(receipt),
        createdAt: nowMs,
      })
      .run();
  }

  private upsertJournal(
    session: Readonly<SessionPrincipal>,
    batch: ValidatedProgressBatch,
    cumulativeFacts: RewardFacts,
    nowMs: number,
  ): void {
    const range = batch.range;

    const highWater = {
      lastEndTick: range.endTick,
      lastSequence: range.endSequence,
      lastEndedAtMs: range.endedAtMs,
      lastRewardDay: range.rewardDay,
      cumulativeFactsJson: JSON.stringify(cumulativeFacts),
    };

    this.db
      .insert(this.journals)
      .values({
        journalId: range.metadata.journalId,
        userId: session.userId,
        sessionHash: session.sessionTokenHash,
        sessionGeneration: batch.payload.sessionGeneration,
        consentVersion: batch.payload.consentVersion,
        source: range.metadata.source,
        clockScale: range.metadata.clockScale,
        physicsRevision: range.metadata.physicsRevision,
        routeId: range.metadata.routeId,
        routeRevision: range.metadata.routeRevision,
        physicsJson: JSON.stringify(range.metadata.physics),
        startedAtMs: range.startedAtMs,
        ...highWater,
        createdAt: nowMs,
      })
      .onConflictDoUpdate({ target: this.journals.journalId, set: highWater })
      .run();
  }
}
