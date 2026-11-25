import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import {
  applyDailyLimit,
  applyVoltsDelta,
  hasRewardFactsRegressed,
  quoteVoltsIncrement,
} from "@voltonaut/rules";
import {
  DAILY_VOLTS_LIMIT,
  DailyVoltsBudgetSchema,
  VoltsBalanceSchema,
  VoltsDebitCommandSchema,
  VoltsDebitReceiptSchema,
  VoltsDeltaSchema,
  VoltsRideRangeCommandSchema,
  type BaseVoltsQuote,
  type VoltsBalance,
  type VoltsDebitCommand,
  type VoltsDebitReceipt,
  type VoltsRideRangeCommand,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { CLOCK, type Clock } from "../clock.js";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import {
  createRangeReceipt,
  debitPayloadHash,
  findRideRangeReceipt,
  parseStoredCumulativeFacts,
  parseStoredDebitReceipt,
  parseStoredRangeReceipt,
  rideRangePayloadHash,
  type LedgerRow,
  type VoltsLedgerTransaction,
} from "./economy.codec.js";
import { ECONOMY_TABLES, type EconomyTables } from "./economy.schema.js";

type LedgerDb = Readonly<Pick<ServerDatabase, "get" | "select" | "insert">>;

type RangeCommand = Readonly<VoltsRideRangeCommand>;

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Shared Volts commands contain nested Zod primitive brands; Drizzle handles own mutable driver state. */
@Injectable()
export class EconomyService {
  private readonly ledger: EconomyTables["voltsLedger"];

  public constructor(
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(ECONOMY_TABLES) tables: EconomyTables,
    @Inject(CLOCK) private readonly clock: Readonly<Clock>,
  ) {
    this.ledger = tables.voltsLedger;
  }

  public balance(userId: string): VoltsBalance {
    return this.balanceWithin(this.db, userId);
  }

  public creditRideRange(userId: string, command: RangeCommand): VoltsRideRangeReceipt {
    return this.transaction((tx) => tx.creditRideRange(userId, command));
  }

  public debit(userId: string, command: Readonly<VoltsDebitCommand>): VoltsDebitReceipt {
    return this.transaction((tx) => tx.debit(userId, command));
  }

  public transaction<T>(work: (tx: VoltsLedgerTransaction) => T): T {
    return this.db.transaction(
      (tx: LedgerDb) =>
        work({
          balance: (userId) => this.balanceWithin(tx, userId),
          rideRangeReceipt: (userId, journalId, startTick) =>
            findRideRangeReceipt(tx, this.ledger, userId, journalId, startTick),
          creditRideRange: (userId, command) => this.rangeWithin(tx, userId, command),
          debit: (userId, command) => this.debitWithin(tx, userId, command),
        }),
      { behavior: "immediate" },
    );
  }

  private balanceWithin(db: LedgerDb, userId: string): VoltsBalance {
    const row = db.get<{ balance: number }>(
      sql`select coalesce(sum(${this.ledger.deltaVolts}), 0) as balance from ${this.ledger} where ${this.ledger.userId} = ${userId}`,
    );

    return VoltsBalanceSchema.parse(row.balance);
  }

  private rangeWithin(db: LedgerDb, userId: string, command: RangeCommand): VoltsRideRangeReceipt {
    const parsed = VoltsRideRangeCommandSchema.parse(command);
    const idempotencyKey = `ride:${parsed.journalId}:${parsed.startTick}`;
    const hash = rideRangePayloadHash(parsed);
    const existing = this.existingRange(db, userId, idempotencyKey, hash, parsed);

    if (existing !== undefined) return existing;

    const previous = this.previousQuote(db, userId, parsed);
    const quote = quoteVoltsIncrement(previous, parsed.cumulativeFacts);

    if (quote.kind === "regressed") throw new ApiError(409, "ledger_conflict", "range regressed");

    const limited = applyDailyLimit(
      quote.increment,
      DailyVoltsBudgetSchema.parse(this.dailyBudget(db, userId, parsed.rewardDay)),
    );

    const entryId = randomUUID();

    db.insert(this.ledger)
      .values({
        id: entryId,
        userId,
        deltaVolts: limited.quotedVolts,
        reason: "ride_reward",
        refId: parsed.journalId,
        idempotencyKey,
        payloadHash: hash,
        rewardDay: parsed.rewardDay,
        startTick: parsed.startTick,
        endTick: parsed.endTick,
        candidateVolts: quote.increment.total,
        cumulativeWorkVolts: quote.cumulative.work,
        cumulativeClimbVolts: quote.cumulative.climb,
        cumulativeFactsJson: JSON.stringify(parsed.cumulativeFacts),
        createdAt: this.clock.nowMs(),
      })
      .run();

    return createRangeReceipt(
      entryId,
      parsed,
      quote.cumulative,
      quote.increment,
      limited.quotedVolts,
      limited.withheldVolts,
    );
  }

  private existingRange(
    db: LedgerDb,
    userId: string,
    idempotencyKey: string,
    hash: string,
    command: RangeCommand,
  ): VoltsRideRangeReceipt | undefined {
    const row = this.findEntry(db, userId, idempotencyKey);

    if (row === undefined) return undefined;

    if (row.payloadHash !== hash) throw new ApiError(409, "ledger_conflict", "ledger conflict");

    const receipt = parseStoredRangeReceipt(row);

    if (
      receipt.journalId !== command.journalId ||
      receipt.startTick !== command.startTick ||
      receipt.endTick !== command.endTick ||
      receipt.rewardDay !== command.rewardDay
    ) {
      throw new ApiError(500, "internal_error", "corrupt Volts ledger entry");
    }

    return receipt;
  }

  private previousQuote(db: LedgerDb, userId: string, command: RangeCommand): BaseVoltsQuote {
    const latest = db
      .select()
      .from(this.ledger)
      .where(and(eq(this.ledger.refId, command.journalId), eq(this.ledger.reason, "ride_reward")))
      .orderBy(desc(this.ledger.endTick))
      .limit(1)
      .get();

    if (latest === undefined) {
      if (command.startTick !== 0)
        throw new ApiError(409, "ledger_conflict", "first range must start at tick zero");

      return { work: 0, climb: 0, total: 0 };
    }

    if (latest.userId !== userId) throw new ApiError(404, "not_found", "ride journal not found");

    const stored = parseStoredRangeReceipt(latest);
    const previousFacts = parseStoredCumulativeFacts(latest);

    if (command.startTick !== stored.endTick || command.rewardDay < stored.rewardDay) {
      throw new ApiError(409, "ledger_conflict", "range is not contiguous");
    }

    if (hasRewardFactsRegressed(previousFacts, command.cumulativeFacts)) {
      throw new ApiError(409, "ledger_conflict", "cumulative facts regressed");
    }

    return {
      work: stored.cumulativeWorkVolts,
      climb: stored.cumulativeClimbVolts,
      total: stored.cumulativeWorkVolts + stored.cumulativeClimbVolts,
    };
  }

  private findEntry(db: LedgerDb, userId: string, idempotencyKey: string): LedgerRow | undefined {
    return db
      .select()
      .from(this.ledger)
      .where(and(eq(this.ledger.userId, userId), eq(this.ledger.idempotencyKey, idempotencyKey)))
      .get();
  }

  private debitWithin(
    db: LedgerDb,
    userId: string,
    command: Readonly<VoltsDebitCommand>,
  ): VoltsDebitReceipt {
    const parsed = VoltsDebitCommandSchema.parse(command);
    const hash = debitPayloadHash(parsed);
    const existing = this.existingDebit(db, userId, parsed, hash);

    if (existing !== undefined) return existing;

    const application = applyVoltsDelta(
      this.balanceWithin(db, userId),
      VoltsDeltaSchema.parse(parsed.amountVolts * -1),
    );

    if (application.kind === "insufficient_volts") {
      throw new ApiError(409, "insufficient_volts", "insufficient Volts balance");
    }

    const entryId = randomUUID();
    db.insert(this.ledger)
      .values({
        id: entryId,
        userId,
        deltaVolts: parsed.amountVolts * -1,
        reason: "purchase",
        refId: parsed.refId,
        idempotencyKey: parsed.idempotencyKey,
        payloadHash: hash,
        rewardDay: null,
        startTick: null,
        endTick: null,
        candidateVolts: null,
        cumulativeWorkVolts: null,
        cumulativeClimbVolts: null,
        cumulativeFactsJson: null,
        createdAt: this.clock.nowMs(),
      })
      .run();

    return VoltsDebitReceiptSchema.parse({
      entryId,
      refId: parsed.refId,
      amountVolts: parsed.amountVolts,
    });
  }

  private existingDebit(
    db: LedgerDb,
    userId: string,
    command: Readonly<VoltsDebitCommand>,
    hash: string,
  ): VoltsDebitReceipt | undefined {
    const row = this.findEntry(db, userId, command.idempotencyKey);

    if (row === undefined) return undefined;

    if (row.payloadHash !== hash) throw new ApiError(409, "ledger_conflict", "ledger conflict");

    const receipt = parseStoredDebitReceipt(row);

    if (receipt.refId !== command.refId) {
      throw new ApiError(500, "internal_error", "corrupt Volts ledger entry");
    }

    return receipt;
  }

  private dailyBudget(db: LedgerDb, userId: string, rewardDay: RangeCommand["rewardDay"]): number {
    const row = db.get<{ total: number }>(
      sql`select coalesce(sum(${this.ledger.deltaVolts}), 0) as total from ${this.ledger} where ${this.ledger.userId} = ${userId} and ${this.ledger.rewardDay} = ${rewardDay} and ${this.ledger.reason} = 'ride_reward'`,
    );

    if (!Number.isSafeInteger(row.total) || row.total < 0)
      throw new ApiError(500, "internal_error", "corrupt ledger");

    if (row.total > DAILY_VOLTS_LIMIT) {
      throw new ApiError(500, "internal_error", "corrupt Volts daily reward total");
    }

    return DAILY_VOLTS_LIMIT - row.total;
  }
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
