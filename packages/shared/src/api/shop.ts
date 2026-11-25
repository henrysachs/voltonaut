import { z } from "zod";

import { VoltsBalanceSchema, VoltsDebitAmountSchema } from "../economy.js";

/** Catalog item id, same bounds as the avatar catalog. */
const ItemIdSchema = z.string().trim().min(1).max(120);

/** `default` items are owned by every account without a stored row (spec E7-02 AK3). */
export const InventorySourceSchema = z.enum(["default", "shop"]);

export const InventoryItemSchema = z
  .object({
    itemId: ItemIdSchema,
    source: InventorySourceSchema,
    acquiredAt: z.string().datetime().nullable(),
  })
  .strict()
  .refine((item) => (item.source === "default") === (item.acquiredAt === null), {
    message: "Only default items have no acquisition time",
    path: ["acquiredAt"],
  })
  .readonly();

export const InventoryResponseSchema = z
  .object({ items: z.array(InventoryItemSchema).max(1000).readonly() })
  .strict()
  .readonly();

/** `requestId` makes a retried purchase idempotent; `expectedPriceVolts` guards against price changes. */
export const PurchaseRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    itemId: ItemIdSchema,
    expectedPriceVolts: VoltsDebitAmountSchema,
  })
  .strict()
  .readonly();

export const PurchaseResponseSchema = z
  .object({ voltsBalance: VoltsBalanceSchema, item: InventoryItemSchema })
  .strict()
  .readonly();

/** Input of the pure purchase decision in `@voltonaut/rules`. */
export const PurchaseDecisionInputSchema = z
  .object({
    itemId: ItemIdSchema,
    expectedPriceVolts: VoltsDebitAmountSchema,
    ownedItemIds: z.array(ItemIdSchema).max(1000).readonly(),
  })
  .strict()
  .readonly();

export type PurchaseDecisionInput = z.input<typeof PurchaseDecisionInputSchema>;

export type InventorySource = z.infer<typeof InventorySourceSchema>;

export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;

export type PurchaseRequest = z.infer<typeof PurchaseRequestSchema>;

export type PurchaseResponse = z.infer<typeof PurchaseResponseSchema>;
