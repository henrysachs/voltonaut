import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { applyVoltsDelta } from "@voltonaut/rules";
import {
  VoltsBalanceSchema,
  VoltsDeltaSchema,
  VoltsGrantCommandSchema,
  type VoltsGrantCommand,
  type VoltsGrantReceipt,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import type { Clock } from "../clock.js";
import type { ServerDatabase } from "../database/drizzle.provider.js";
import { grantPayloadHash, parseStoredGrantReceipt, type LedgerRow } from "./economy.codec.js";
import type { EconomyTables } from "./economy.schema.js";

interface GrantContext {
  readonly db: Readonly<Pick<ServerDatabase, "select" | "insert" | "get">>;
  readonly ledger: EconomyTables["voltsLedger"];
  readonly nowMs: () => number;
}

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Drizzle table metadata and Zod-branded commands stay mutable for the query builders. */
function findEntry(context: GrantContext, userId: string, key: string): LedgerRow | undefined {
  return context.db
    .select()
    .from(context.ledger)
    .where(and(eq(context.ledger.userId, userId), eq(context.ledger.idempotencyKey, key)))
    .get();
}

function balanceWithin(context: GrantContext, userId: string) {
  const row = context.db.get<{ balance: number }>(
    sql`select coalesce(sum(${context.ledger.deltaVolts}), 0) as balance from ${context.ledger} where ${context.ledger.userId} = ${userId}`,
  );

  return VoltsBalanceSchema.parse(row.balance);
}

/**
 * Operator credit inside the caller's immediate transaction (spec E7-02 AK7):
 * an identical replay returns the stored receipt, a different payload under the
 * same `operator:` key is a conflict.
 */
export function grantWithin(
  context: GrantContext,
  userId: string,
  command: Readonly<VoltsGrantCommand>,
): VoltsGrantReceipt {
  const parsed = VoltsGrantCommandSchema.parse(command);
  const hash = grantPayloadHash(parsed);
  const existing = findEntry(context, userId, parsed.idempotencyKey);

  if (existing !== undefined) {
    if (existing.payloadHash !== hash)
      throw new ApiError(409, "ledger_conflict", "ledger conflict");

    return parseStoredGrantReceipt(existing);
  }

  // Same safe-integer guard as debits: an overflowing credit would make every later balance read fail.
  applyVoltsDelta(balanceWithin(context, userId), VoltsDeltaSchema.parse(parsed.amountVolts));
  context.db
    .insert(context.ledger)
    .values({
      id: randomUUID(),
      userId,
      deltaVolts: parsed.amountVolts,
      reason: "operator_grant",
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
      createdAt: context.nowMs(),
    })
    .run();

  const stored = findEntry(context, userId, parsed.idempotencyKey);

  if (stored === undefined) throw new ApiError(500, "internal_error", "Volts ledger write lost");

  return parseStoredGrantReceipt(stored);
}

/**
 * Operator credits for the admin CLI and tests (spec E7-02 AK7). There is no web
 * endpoint: Volts cannot be earned until confirmed ride sections exist (#59).
 */
export class OperatorGrants {
  public constructor(
    private readonly db: ServerDatabase,
    private readonly tables: Pick<EconomyTables, "voltsLedger">,
    private readonly clock: Readonly<Clock>,
  ) {}

  public grant(userId: string, command: Readonly<VoltsGrantCommand>): VoltsGrantReceipt {
    return this.db.transaction(
      (tx: Readonly<Pick<ServerDatabase, "select" | "insert" | "get">>) =>
        grantWithin(
          { db: tx, ledger: this.tables.voltsLedger, nowMs: this.clock.nowMs },
          userId,
          command,
        ),
      { behavior: "immediate" },
    );
  }
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
