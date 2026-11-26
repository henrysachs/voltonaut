import { z } from "zod";

import { ItemIdSchema } from "../avatarCatalog.js";
import { VoltsBalanceSchema, VoltsDebitAmountSchema } from "../economy.js";
import { LoadoutResponseSchema } from "./loadout.js";

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

/** Personal data export: purchased items only; catalog defaults belong to every account. */
const PurchasedItemSchema = InventoryItemSchema.refine((item) => item.source !== "default", {
  message: "Exports list purchased items only",
  path: ["source"],
});

export const InventoryAccountExportSchema = z
  .object({
    items: z.array(PurchasedItemSchema).max(1000).readonly(),
    /** Stored equipment, or the default loadout with `updatedAt: null` (spec E7-05 AK5). */
    loadout: LoadoutResponseSchema,
  })
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

export type InventoryAccountExport = z.infer<typeof InventoryAccountExportSchema>;

export type PurchaseRequest = z.infer<typeof PurchaseRequestSchema>;

/** Unbranded purchase order as a client builds it before `PurchaseRequestSchema` parses it. */
export type PurchaseOrder = z.input<typeof PurchaseRequestSchema>;

export type PurchaseResponse = z.infer<typeof PurchaseResponseSchema>;
