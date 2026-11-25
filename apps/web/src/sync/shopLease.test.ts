import { expect, it } from "vitest";
import { shopLease, type ShopRequest } from "./shopLease.js";

const ORDER = {
  requestId: "6f1c2b4e-8d3a-4c5b-9e7f-0a1b2c3d4e5f",
  itemId: "jersey.stripe",
  expectedPriceVolts: 1500,
};

function recorder(receiptItemId = ORDER.itemId) {
  const calls: { readonly path: string; readonly body: string | undefined }[] = [];

  const responses = {
    "/v1/me/volts": { voltsBalance: 12 },
    "/v1/me/inventory": { items: [] },
    "/v1/shop/purchase": {
      voltsBalance: 0,
      item: { itemId: receiptItemId, source: "shop", acquiredAt: "2026-11-25T10:00:00.000Z" },
    },
  };

  const request: ShopRequest = (path, schema, body) => {
    calls.push({ path, body });

    return Promise.resolve(schema.parse(responses[path]));
  };

  return { calls, lease: shopLease(request) };
}

it("reads balance and inventory and posts the parsed purchase order", async () => {
  const { calls, lease } = recorder();

  await expect(lease.balance()).resolves.toEqual({ voltsBalance: 12 });
  await expect(lease.inventory()).resolves.toEqual({ items: [] });
  await expect(lease.purchase(ORDER)).resolves.toMatchObject({ voltsBalance: 0 });
  expect(calls).toEqual([
    { path: "/v1/me/volts", body: undefined },
    { path: "/v1/me/inventory", body: undefined },
    { path: "/v1/shop/purchase", body: JSON.stringify(ORDER) },
  ]);
});

it("rejects invalid orders before any request and receipts for another item", async () => {
  const { calls, lease } = recorder("jersey.other");

  await expect(lease.purchase({ ...ORDER, requestId: "nope" })).rejects.toThrow("Invalid uuid");
  expect(calls).toEqual([]);
  await expect(lease.purchase(ORDER)).rejects.toThrow("Purchase receipt mismatch");
});
