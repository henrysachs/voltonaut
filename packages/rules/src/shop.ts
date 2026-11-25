import { PurchaseDecisionInputSchema, type PurchaseDecisionInput } from "@voltonaut/shared";

import { START_AVATAR_CATALOG } from "./avatarCatalogData.js";

export type PurchaseDecision =
  | { readonly kind: "purchasable"; readonly priceVolts: number }
  | { readonly kind: "unknown_item" }
  | { readonly kind: "not_for_sale" }
  | { readonly kind: "already_owned" }
  | { readonly kind: "price_changed"; readonly priceVolts: number };

/**
 * Whether an account may buy a catalog item (spec E7-02 AK2). The minimum level
 * of shop items is deliberately not checked until server progression exists.
 */
export function decidePurchase(input: PurchaseDecisionInput): PurchaseDecision {
  const parsed = PurchaseDecisionInputSchema.parse(input);
  const item = START_AVATAR_CATALOG.find((candidate) => candidate.id === parsed.itemId);

  if (item === undefined) return { kind: "unknown_item" };

  if (parsed.ownedItemIds.includes(item.id)) return { kind: "already_owned" };

  if (item.unlock.kind !== "shop") return { kind: "not_for_sale" };

  const priceVolts = item.unlock.priceVolts;

  return parsed.expectedPriceVolts === priceVolts
    ? { kind: "purchasable", priceVolts }
    : { kind: "price_changed", priceVolts };
}

/** Catalog items every account owns without a stored inventory row. */
export function defaultInventoryItemIds(): readonly string[] {
  return START_AVATAR_CATALOG.filter((item) => item.unlock.kind === "default").map(
    (item) => item.id,
  );
}
