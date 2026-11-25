import { expect, it } from "vitest";
import type { PrivateSend } from "./apiRoute.js";
import { shopPort, shopRoutes } from "./shopPort.js";

const ORDER = {
  requestId: "6f1c2b4e-8d3a-4c5b-9e7f-0a1b2c3d4e5f",
  itemId: "jersey.stripe",
  expectedPriceVolts: 1500,
};

function recorder(receiptItemId = ORDER.itemId) {
  const calls: {
    readonly method: string;
    readonly path: string;
    readonly body: string | undefined;
  }[] = [];

  const reply = (path: string) =>
    path === "/v1/me/volts"
      ? { voltsBalance: 12 }
      : path === "/v1/me/inventory"
        ? { items: [] }
        : {
            voltsBalance: 0,
            item: { itemId: receiptItemId, source: "shop", acquiredAt: "2026-11-25T10:00:00.000Z" },
          };

  const send: PrivateSend = (route, input) => {
    const path = route.path(input);
    const body = route.method === "GET" || route.body === null ? undefined : route.body(input);
    calls.push({ method: route.method, path, body });

    return Promise.resolve(route.response.parse(reply(path)));
  };

  return { calls, port: shopPort(send) };
}

it("reads balance and inventory and posts the parsed purchase order", async () => {
  const { calls, port } = recorder();

  await expect(port.balance()).resolves.toEqual({ voltsBalance: 12 });
  await expect(port.inventory()).resolves.toEqual({ items: [] });
  await expect(port.purchase(ORDER)).resolves.toMatchObject({ voltsBalance: 0 });
  expect(calls).toEqual([
    { method: "GET", path: "/v1/me/volts", body: undefined },
    { method: "GET", path: "/v1/me/inventory", body: undefined },
    { method: "POST", path: "/v1/shop/purchase", body: JSON.stringify(ORDER) },
  ]);
});

it("rejects invalid orders before any request and receipts for another item", async () => {
  const { calls, port } = recorder("jersey.other");

  await expect(port.purchase({ ...ORDER, requestId: "nope" })).rejects.toThrow("Invalid uuid");
  expect(calls).toEqual([]);
  await expect(port.purchase(ORDER)).rejects.toThrow("Purchase receipt mismatch");
});

it("never sends shop calls with browser cookies", () => {
  expect(Object.values(shopRoutes).map((route) => route.credentials)).toEqual([
    "omit",
    "omit",
    "omit",
  ]);
});
