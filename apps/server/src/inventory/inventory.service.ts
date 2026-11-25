import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { decidePurchase, defaultInventoryItemIds } from "@voltonaut/rules";
import {
  InventoryItemSchema,
  InventoryResponseSchema,
  PurchaseRequestSchema,
  PurchaseResponseSchema,
  VoltsDebitCommandSchema,
  type InventoryItem,
  type InventoryResponse,
  type PurchaseRequest,
  type PurchaseResponse,
} from "@voltonaut/shared";
import { ApiError } from "../api-error.js";
import { CLOCK, type Clock } from "../clock.js";
import { DRIZZLE, type ServerDatabase } from "../database/drizzle.provider.js";
import type { VoltsLedgerTransaction } from "../economy/economy.codec.js";
import { EconomyService } from "../economy/economy.service.js";
import { INVENTORY_TABLES, type InventoryTables } from "./inventory.schema.js";

type InventoryRow = InventoryTables["inventory"]["$inferSelect"];

function storedItem(row: Readonly<InventoryRow>): InventoryItem {
  return InventoryItemSchema.parse({
    itemId: row.itemId,
    source: row.source,
    acquiredAt: new Date(row.acquiredAt).toISOString(),
  });
}

/* oxlint-disable typescript/prefer-readonly-parameter-types -- Drizzle and the ledger port own mutable driver state. */
@Injectable()
export class InventoryService {
  private readonly inventory: InventoryTables["inventory"];

  public constructor(
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
    @Inject(INVENTORY_TABLES) tables: InventoryTables,
    @Inject(EconomyService) private readonly economy: Pick<EconomyService, "transaction">,
    @Inject(CLOCK) private readonly clock: Readonly<Clock>,
  ) {
    this.inventory = tables.inventory;
  }

  /** Catalog defaults plus stored items, oldest purchase first (spec E7-02 AK6). */
  public list(userId: string): InventoryResponse {
    const defaults = defaultInventoryItemIds().map((itemId) =>
      InventoryItemSchema.parse({ itemId, source: "default", acquiredAt: null }),
    );

    return InventoryResponseSchema.parse({
      items: [...defaults, ...this.rows(userId).map((row) => storedItem(row))],
    });
  }

  /**
   * Debit and ownership commit together (spec E7-02 AK4): the inventory write runs
   * on the same SQLite connection inside the ledger's immediate transaction, so a
   * failure rolls back the debit as well.
   */
  public purchase(userId: string, request: Readonly<PurchaseRequest>): PurchaseResponse {
    const parsed = PurchaseRequestSchema.parse(request);

    return this.economy.transaction((ledger) => this.purchaseWithin(ledger, userId, parsed));
  }

  private purchaseWithin(
    ledger: VoltsLedgerTransaction,
    userId: string,
    request: PurchaseRequest,
  ): PurchaseResponse {
    const rows = this.rows(userId);
    const replay = rows.find((row) => row.purchaseRequestId === request.requestId);

    if (replay !== undefined) return this.replayed(ledger, userId, request, replay);

    const decision = decidePurchase({
      itemId: request.itemId,
      expectedPriceVolts: request.expectedPriceVolts,
      ownedItemIds: [...defaultInventoryItemIds(), ...rows.map((row) => row.itemId)],
    });

    switch (decision.kind) {
      case "unknown_item":
        throw new ApiError(404, "not_found", "item not found");
      case "not_for_sale":
        throw new ApiError(409, "item_not_for_sale", "item is not sold in the shop");
      case "already_owned":
        throw new ApiError(409, "already_owned", "item already owned");
      case "price_changed":
        throw new ApiError(409, "price_changed", "item price changed");
      case "purchasable":
        return this.buy(ledger, userId, request, decision.priceVolts);
      default: {
        const exhaustive: never = decision;

        return exhaustive;
      }
    }
  }

  private buy(
    ledger: VoltsLedgerTransaction,
    userId: string,
    request: PurchaseRequest,
    priceVolts: number,
  ): PurchaseResponse {
    ledger.debit(
      userId,
      VoltsDebitCommandSchema.parse({
        idempotencyKey: `purchase:${request.requestId}`,
        refId: request.itemId,
        amountVolts: priceVolts,
      }),
    );

    const row = {
      userId,
      itemId: request.itemId,
      source: "shop" as const,
      purchaseRequestId: request.requestId,
      acquiredAt: this.clock.nowMs(),
    };

    this.db.insert(this.inventory).values(row).run();

    return PurchaseResponseSchema.parse({
      voltsBalance: ledger.balance(userId),
      item: storedItem(row),
    });
  }

  /** A retried request returns its original item; the same id for another item is a conflict. */
  private replayed(
    ledger: VoltsLedgerTransaction,
    userId: string,
    request: PurchaseRequest,
    row: InventoryRow,
  ): PurchaseResponse {
    if (row.itemId !== request.itemId)
      throw new ApiError(409, "ledger_conflict", "request id used for another item");

    return PurchaseResponseSchema.parse({
      voltsBalance: ledger.balance(userId),
      item: storedItem(row),
    });
  }

  private rows(userId: string): readonly InventoryRow[] {
    return this.db
      .select()
      .from(this.inventory)
      .where(and(eq(this.inventory.userId, userId)))
      .orderBy(asc(this.inventory.acquiredAt), asc(this.inventory.itemId))
      .all();
  }
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
