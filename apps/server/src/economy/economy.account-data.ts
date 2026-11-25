import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { VoltsAccountExportSchema, type VoltsAccountExport } from "@voltonaut/shared";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import {
  parseStoredCumulativeFacts,
  parseStoredDebitReceipt,
  parseStoredGrantReceipt,
  parseStoredRangeReceipt,
  type LedgerRow,
} from "./economy.codec.js";
import { ECONOMY_TABLES, type EconomyTables } from "./economy.schema.js";
import { EconomyService } from "./economy.service.js";

function exportRow(row: Readonly<LedgerRow>) {
  const common = {
    id: row.id,
    deltaVolts: row.deltaVolts,
    refId: row.refId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    createdAt: new Date(row.createdAt).toISOString(),
  };

  if (row.reason === "purchase") {
    parseStoredDebitReceipt(row);

    return { ...common, reason: row.reason };
  }

  if (row.reason === "operator_grant") {
    parseStoredGrantReceipt(row);

    return { ...common, reason: row.reason };
  }

  const receipt = parseStoredRangeReceipt(row);

  return {
    ...common,
    reason: row.reason,
    rewardDay: receipt.rewardDay,
    startTick: receipt.startTick,
    endTick: receipt.endTick,
    candidateVolts: receipt.candidateVolts,
    cumulativeWorkVolts: receipt.cumulativeWorkVolts,
    cumulativeClimbVolts: receipt.cumulativeClimbVolts,
    cumulativeFacts: parseStoredCumulativeFacts(row),
  };
}

/** Account export/deletion port for the Volts ledger; economy stays the only owner of the table. */
@Injectable()
export class EconomyAccountDataService {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle handles contain mutable driver state; retain the ORM type.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle tables contain mutable column metadata required by query builders.
    @Inject(ECONOMY_TABLES) private readonly tables: EconomyTables,
    @Inject(EconomyService) private readonly economy: Readonly<Pick<EconomyService, "balance">>,
  ) {}

  public exportOwn(userId: string): VoltsAccountExport {
    const ledger = this.tables.voltsLedger;

    const rows = this.db
      .select()
      .from(ledger)
      .where(eq(ledger.userId, userId))
      .orderBy(asc(ledger.createdAt), asc(ledger.id))
      .all();

    return VoltsAccountExportSchema.parse({
      balance: this.economy.balance(userId),
      journal: rows.map((row) => exportRow(row)),
    });
  }

  public deleteOwn(userId: string): void {
    const ledger = this.tables.voltsLedger;

    this.db.delete(ledger).where(eq(ledger.userId, userId)).run();
  }
}
