import { expect, it } from "vitest";

import { decidePurchase, defaultInventoryItemIds, START_AVATAR_CATALOG } from "./index.js";

function decision(
  itemId: string,
  expectedPriceVolts: number,
  ownedItemIds: readonly string[] = [],
) {
  return decidePurchase({ itemId, expectedPriceVolts, ownedItemIds });
}

it("rejects missing inputs at the public boundary", () => {
  expect(decidePurchase).toThrow("Required");
});

it("sells a shop item at its catalog price", () => {
  expect(decision("helmet.aero", 1500)).toEqual({ kind: "purchasable", priceVolts: 1500 });
});

it("ignores the minimum level until progression exists (spec E7-02 transition)", () => {
  expect(decision("wheels.carbon-flat", 6000)).toEqual({ kind: "purchasable", priceVolts: 6000 });
  expect(decision("jersey.aurora", 20_000)).toEqual({ kind: "purchasable", priceVolts: 20_000 });
});

it("reports unknown items, non-shop items and stale prices", () => {
  expect(decision("helmet.unknown", 1500)).toEqual({ kind: "unknown_item" });
  expect(decision("jersey.classic", 1500)).toEqual({ kind: "not_for_sale" });
  expect(decision("jersey.tempo", 1500)).toEqual({ kind: "not_for_sale" });
  expect(decision("helmet.aero", 1499)).toEqual({ kind: "price_changed", priceVolts: 1500 });
  expect(decision("helmet.aero", 1501)).toEqual({ kind: "price_changed", priceVolts: 1500 });
});

it("refuses an item the account already owns before checking the price", () => {
  expect(decision("helmet.aero", 1, ["helmet.aero"])).toEqual({ kind: "already_owned" });
  expect(decision("helmet.aero", 1500, ["glasses.clear"])).toEqual({
    kind: "purchasable",
    priceVolts: 1500,
  });
});

it("lists exactly the catalog items every account owns by default", () => {
  expect(defaultInventoryItemIds()).toEqual(
    START_AVATAR_CATALOG.filter((item) => item.unlock.kind === "default").map((item) => item.id),
  );
  expect(defaultInventoryItemIds()).toContain("jersey.classic");
  expect(defaultInventoryItemIds()).not.toContain("helmet.aero");
});
