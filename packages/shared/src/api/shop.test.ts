import { expect, it } from "vitest";

import {
  ErrorCodeSchema,
  InventoryResponseSchema,
  PurchaseRequestSchema,
  PurchaseResponseSchema,
} from "./index.js";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";

it("accepts a purchase request with request id, item and expected price", () => {
  expect(
    PurchaseRequestSchema.parse({
      requestId: REQUEST_ID,
      itemId: "helmet.aero",
      expectedPriceVolts: 1500,
    }),
  ).toEqual({ requestId: REQUEST_ID, itemId: "helmet.aero", expectedPriceVolts: 1500 });
});

it("rejects purchase requests without uuid, with zero or fractional price or extra fields", () => {
  const valid = { requestId: REQUEST_ID, itemId: "helmet.aero", expectedPriceVolts: 1500 };

  expect(PurchaseRequestSchema.safeParse({ ...valid, requestId: "abc" }).success).toBe(false);
  expect(PurchaseRequestSchema.safeParse({ ...valid, expectedPriceVolts: 0 }).success).toBe(false);
  expect(PurchaseRequestSchema.safeParse({ ...valid, expectedPriceVolts: 1.5 }).success).toBe(
    false,
  );
  expect(PurchaseRequestSchema.safeParse({ ...valid, itemId: "" }).success).toBe(false);
  expect(PurchaseRequestSchema.safeParse({ ...valid, userId: "x" }).success).toBe(false);
});

it("accepts stored and default inventory items and rejects unknown sources", () => {
  const inventory = {
    items: [
      { itemId: "jersey.classic", source: "default", acquiredAt: null },
      { itemId: "helmet.aero", source: "shop", acquiredAt: "2026-11-25T10:00:00.000Z" },
    ],
  };

  expect(InventoryResponseSchema.parse(inventory)).toEqual(inventory);
  expect(
    InventoryResponseSchema.safeParse({
      items: [{ itemId: "x", source: "gift", acquiredAt: null }],
    }).success,
  ).toBe(false);
  expect(
    InventoryResponseSchema.safeParse({
      items: [{ itemId: "x", source: "shop", acquiredAt: null }],
    }).success,
  ).toBe(false);
});

it("returns the remaining balance with the bought item", () => {
  const response = {
    voltsBalance: 500,
    item: { itemId: "helmet.aero", source: "shop", acquiredAt: "2026-11-25T10:00:00.000Z" },
  };

  expect(PurchaseResponseSchema.parse(response)).toEqual(response);
  expect(PurchaseResponseSchema.safeParse({ ...response, voltsBalance: -1 }).success).toBe(false);
});

it("knows the shop error codes", () => {
  expect(
    ["already_owned", "item_not_for_sale", "price_changed"].map(
      (code) => ErrorCodeSchema.safeParse(code).success,
    ),
  ).toEqual([true, true, true]);
});
