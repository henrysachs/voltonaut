import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import {
  RewardFactsSchema,
  VoltsDebitReceiptSchema,
  VoltsGrantReceiptSchema,
  VoltsRideRangeReceiptSchema,
  type BaseVoltsQuote,
  type RewardFacts,
  type VoltsBalance,
  type VoltsDebitCommand,
  type VoltsDebitReceipt,
  type VoltsGrantCommand,
  type VoltsGrantReceipt,
  type VoltsRideRangeCommand,
  type VoltsRideRangeReceipt,
} from "@voltonaut/shared";

import { ApiError } from "../api-error.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import type { EconomyTables } from "./economy.schema.js";

export type LedgerRow = EconomyTables["voltsLedger"]["$inferSelect"];

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Shared Volts commands contain nested Zod primitive brands. */
export interface VoltsLedgerTransaction {
  balance(userId: string): VoltsBalance;
  rideRangeReceipt(
    userId: string,
    journalId: string,
    startTick: number,
  ): VoltsRideRangeReceipt | undefined;
  creditRideRange(userId: string, command: Readonly<VoltsRideRangeCommand>): VoltsRideRangeReceipt;
  debit(userId: string, command: Readonly<VoltsDebitCommand>): VoltsDebitReceipt;
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

function payloadHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Shared Volts commands contain nested Zod primitive brands.
export function rideRangePayloadHash(command: Readonly<VoltsRideRangeCommand>): string {
  return payloadHash(
    JSON.stringify({
      journalId: command.journalId,
      startTick: command.startTick,
      endTick: command.endTick,
      rewardDay: command.rewardDay,
      cumulativeFacts: {
        activeDistanceM: command.cumulativeFacts.activeDistanceM,
        activeElevationGainM: command.cumulativeFacts.activeElevationGainM,
        activeTimeS: command.cumulativeFacts.activeTimeS,
        elevationGainM: command.cumulativeFacts.elevationGainM,
        energyKj: command.cumulativeFacts.energyKj,
      },
    }),
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Shared Volts commands contain nested Zod primitive brands.
export function debitPayloadHash(command: Readonly<VoltsDebitCommand>): string {
  return payloadHash(
    JSON.stringify({
      idempotencyKey: command.idempotencyKey,
      refId: command.refId,
      amountVolts: command.amountVolts,
    }),
  );
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Shared Volts commands contain nested Zod primitive brands.
export function grantPayloadHash(command: Readonly<VoltsGrantCommand>): string {
  return payloadHash(
    JSON.stringify({
      kind: "operator_grant",
      idempotencyKey: command.idempotencyKey,
      refId: command.refId,
      amountVolts: command.amountVolts,
    }),
  );
}

export function createRangeReceipt(
  entryId: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Shared Volts commands contain nested Zod primitive brands.
  command: Readonly<VoltsRideRangeCommand>,
  cumulative: Readonly<BaseVoltsQuote>,
  increment: Readonly<BaseVoltsQuote>,
  awardedVolts: number,
  withheldVolts: number,
): VoltsRideRangeReceipt {
  return VoltsRideRangeReceiptSchema.parse({
    entryId,
    journalId: command.journalId,
    startTick: command.startTick,
    endTick: command.endTick,
    rewardDay: command.rewardDay,
    cumulativeWorkVolts: cumulative.work,
    cumulativeClimbVolts: cumulative.climb,
    candidateVolts: increment.total,
    awardedVolts,
    withheldVolts,
  });
}

export function parseStoredCumulativeFacts(row: Readonly<LedgerRow>): RewardFacts {
  if (row.reason !== "ride_reward" || row.cumulativeFactsJson === null) {
    throw new ApiError(500, "internal_error", "corrupt Volts ledger entry");
  }

  return RewardFactsSchema.parse(JSON.parse(row.cumulativeFactsJson));
}

export function parseStoredRangeReceipt(row: Readonly<LedgerRow>): VoltsRideRangeReceipt {
  if (
    row.reason !== "ride_reward" ||
    row.rewardDay === null ||
    row.startTick === null ||
    row.endTick === null ||
    row.candidateVolts === null ||
    row.cumulativeWorkVolts === null ||
    row.cumulativeClimbVolts === null ||
    row.deltaVolts < 0
  ) {
    throw new ApiError(500, "internal_error", "corrupt Volts ledger entry");
  }

  return VoltsRideRangeReceiptSchema.parse({
    entryId: row.id,
    journalId: row.refId,
    startTick: row.startTick,
    endTick: row.endTick,
    rewardDay: row.rewardDay,
    cumulativeWorkVolts: row.cumulativeWorkVolts,
    cumulativeClimbVolts: row.cumulativeClimbVolts,
    candidateVolts: row.candidateVolts,
    awardedVolts: row.deltaVolts,
    withheldVolts: row.candidateVolts - row.deltaVolts,
  });
}

export function parseStoredDebitReceipt(row: Readonly<LedgerRow>): VoltsDebitReceipt {
  if (
    row.reason !== "purchase" ||
    row.rewardDay !== null ||
    row.startTick !== null ||
    row.endTick !== null ||
    row.candidateVolts !== null ||
    row.cumulativeWorkVolts !== null ||
    row.cumulativeClimbVolts !== null ||
    row.cumulativeFactsJson !== null ||
    row.deltaVolts >= 0
  ) {
    throw new ApiError(500, "internal_error", "corrupt Volts ledger entry");
  }

  return VoltsDebitReceiptSchema.parse({
    entryId: row.id,
    refId: row.refId,
    amountVolts: -row.deltaVolts,
  });
}

export function findRideRangeReceipt(
  db: Readonly<Pick<ServerDatabase, "select">>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle table metadata must retain its original column references.
  ledger: Readonly<EconomyTables["voltsLedger"]>,
  userId: string,
  journalId: string,
  startTick: number,
): VoltsRideRangeReceipt | undefined {
  const row = db
    .select()
    .from(ledger)
    .where(
      and(eq(ledger.userId, userId), eq(ledger.idempotencyKey, `ride:${journalId}:${startTick}`)),
    )
    .get();

  return row === undefined ? undefined : parseStoredRangeReceipt(row);
}

export function parseStoredGrantReceipt(row: Readonly<LedgerRow>): VoltsGrantReceipt {
  if (
    row.reason !== "operator_grant" ||
    row.rewardDay !== null ||
    row.startTick !== null ||
    row.cumulativeFactsJson !== null ||
    row.deltaVolts <= 0
  ) {
    throw new ApiError(500, "internal_error", "corrupt Volts ledger entry");
  }

  return VoltsGrantReceiptSchema.parse({
    entryId: row.id,
    refId: row.refId,
    amountVolts: row.deltaVolts,
  });
}
