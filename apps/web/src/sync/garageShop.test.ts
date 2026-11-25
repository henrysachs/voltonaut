import { expect, it, vi } from "vitest";
import type { PurchaseOrder, PurchaseResponse } from "@voltonaut/shared";
import {
  PurchaseResponseSchema,
  VoltsBalanceResponseSchema,
  InventoryResponseSchema,
} from "@voltonaut/shared";

import { GarageShop, type GarageShopView } from "./garageShop.js";
import { PrivateRequestError, type AccountLease } from "./privateAuthTransport.js";
import { ShopReceiptMismatch } from "./shopLease.js";
import { unexpectedAccountParts, unusedStravaLease } from "./testdata/unusedStravaLease.js";

const ACQUIRED_AT = "2026-11-25T10:00:00.000Z";

class ShopServer {
  balance = 500;
  owned: string[] = [];
  readonly orders: PurchaseOrder[] = [];
  failure: Error | undefined;
  active = true;

  lease(userId = "rider"): AccountLease {
    return {
      ...unexpectedAccountParts,
      strava: unusedStravaLease,
      signal: new AbortController().signal,
      apiOrigin: "http://localhost:3000",
      userId,
      generation: 1,
      current: () => this.active,
      profile: () => Promise.reject(new Error("unused")),
      saveProfile: () => Promise.reject(new Error("unused")),
      history: () => Promise.reject(new Error("unused")),
      detail: () => Promise.reject(new Error("unused")),
      upload: () => Promise.reject(new Error("unused")),
      shop: {
        balance: () =>
          Promise.resolve(VoltsBalanceResponseSchema.parse({ voltsBalance: this.balance })),
        inventory: () => Promise.resolve(this.inventory()),
        purchase: (order) => this.purchase(order),
      },
    };
  }

  private inventory() {
    return InventoryResponseSchema.parse({
      items: [
        { itemId: "jersey-basic", source: "default", acquiredAt: null },
        ...this.owned.map((itemId) => ({ itemId, source: "shop", acquiredAt: ACQUIRED_AT })),
      ],
    });
  }

  private purchase(order: Readonly<PurchaseOrder>): Promise<PurchaseResponse> {
    this.orders.push(order);

    if (this.failure !== undefined) return Promise.reject(this.failure);
    this.balance -= order.expectedPriceVolts;
    this.owned.push(order.itemId);

    return Promise.resolve(
      PurchaseResponseSchema.parse({
        voltsBalance: this.balance,
        item: { itemId: order.itemId, source: "shop", acquiredAt: ACQUIRED_AT },
      }),
    );
  }
}

async function readyShop() {
  const server = new ShopServer();
  const queue = ["r1", "r2"];
  const shop = new GarageShop(() => queue.shift() ?? "unexpected");
  const views: GarageShopView[] = [];

  shop.subscribe((view) => {
    views.push(view);
  });
  shop.bind(server.lease());
  await vi.waitFor(() => {
    expect(shop.view().kind).toBe("ready");
  });

  return { server, shop, views };
}

it("shows guests nothing to buy and loads balance plus inventory for an account", async () => {
  const guest = new GarageShop();

  expect(guest.view()).toEqual({ kind: "guest" });
  await guest.purchase("helmet-red", 100);

  const { server, shop } = await readyShop();

  expect(shop.view()).toEqual({
    kind: "ready",
    voltsBalance: 500,
    ownedItemIds: ["jersey-basic"],
    pendingItemId: null,
    message: "",
    messageItemId: null,
  });
  expect(server.orders).toEqual([]);
});

it("buys once, shows the item as owned and the server balance", async () => {
  const { server, shop, views } = await readyShop();

  await shop.purchase("helmet-red", 120);

  expect(server.orders).toEqual([
    { requestId: "r1", itemId: "helmet-red", expectedPriceVolts: 120 },
  ]);
  expect(views).toContainEqual(expect.objectContaining({ pendingItemId: "helmet-red" }));
  expect(shop.view()).toMatchObject({
    voltsBalance: 380,
    ownedItemIds: ["jersey-basic", "helmet-red"],
    pendingItemId: null,
  });
});

it("retries an unconfirmed purchase with the same request id", async () => {
  const { server, shop } = await readyShop();

  server.failure = new PrivateRequestError("retry");
  await shop.purchase("helmet-red", 120);

  expect(shop.view()).toMatchObject({ pendingItemId: null, ownedItemIds: ["jersey-basic"] });

  server.failure = undefined;
  await shop.purchase("helmet-red", 120);

  expect(server.orders.map(({ requestId }) => requestId)).toEqual(["r1", "r1"]);
  expect(shop.view()).toMatchObject({ voltsBalance: 380 });
});

it("rereads the server after a rejected purchase and uses a new id next time", async () => {
  const { server, shop } = await readyShop();

  server.failure = new PrivateRequestError("conflict");
  server.balance = 50;
  await shop.purchase("helmet-red", 120);

  expect(shop.view()).toMatchObject({ voltsBalance: 50, pendingItemId: null });
  expect(JSON.stringify(shop.view())).toContain("Kauf abgelehnt");

  server.failure = undefined;
  await shop.purchase("helmet-red", 40);

  expect(server.orders.map(({ requestId }) => requestId)).toEqual(["r1", "r2"]);
});

it("ignores a second purchase while one is open and results of a replaced account", async () => {
  const { server, shop } = await readyShop();
  const first = shop.purchase("helmet-red", 120);

  await shop.purchase("gloves-blue", 80);
  server.active = false;
  shop.bind();
  await first;

  expect(server.orders.map(({ itemId }) => itemId)).toEqual(["helmet-red"]);
  expect(shop.view()).toEqual({ kind: "guest" });
});

it("reports an unreachable shop without inventing a balance", async () => {
  const server = new ShopServer();
  const lease = server.lease();
  const shop = new GarageShop();

  shop.bind({
    ...lease,
    shop: { ...lease.shop, inventory: () => Promise.reject(new PrivateRequestError("retry")) },
  });
  await vi.waitFor(() => {
    expect(shop.view()).toMatchObject({ kind: "failed" });
  });
});

it("treats an unknown item as a final rejection and rereads the server", async () => {
  const { server, shop } = await readyShop();

  server.failure = new PrivateRequestError("missing");
  await shop.purchase("helmet-red", 120);
  server.failure = undefined;
  await shop.purchase("helmet-red", 120);

  expect(server.orders.map(({ requestId }) => requestId)).toEqual(["r1", "r2"]);
});

it("rereads balance and ownership when an earlier purchase stayed unconfirmed", async () => {
  const { server, shop } = await readyShop();

  server.failure = new PrivateRequestError("retry");
  await shop.purchase("helmet-red", 120);
  server.failure = undefined;
  server.owned.push("helmet-red");
  server.balance = 380;
  await shop.purchase("gloves-blue", 80);

  expect(shop.view()).toMatchObject({
    voltsBalance: 300,
    ownedItemIds: ["jersey-basic", "helmet-red", "gloves-blue"],
  });
});

function flakyLease(server: Readonly<Pick<ShopServer, "lease">>, up: () => boolean): AccountLease {
  const lease = server.lease();

  return {
    ...lease,
    shop: {
      ...lease.shop,
      inventory: () =>
        up() ? lease.shop.inventory() : Promise.reject(new PrivateRequestError("retry")),
    },
  };
}

it("rereads a failed shop on retry and ignores retry while ready", async () => {
  let up = false;
  const shop = new GarageShop();

  shop.bind(flakyLease(new ShopServer(), () => up));
  await vi.waitFor(() => {
    expect(shop.view()).toMatchObject({ kind: "failed" });
  });

  up = true;
  await shop.retry();

  expect(shop.view()).toMatchObject({ kind: "ready", voltsBalance: 500 });

  await shop.retry();

  expect(shop.view()).toMatchObject({ kind: "ready" });
});

it("keeps open request ids when the same account re-authenticates", async () => {
  const { server, shop } = await readyShop();

  server.failure = new PrivateRequestError("retry");
  await shop.purchase("helmet-red", 120);
  // AccountSync unbinds while the session is busy, then binds the renewed lease.
  shop.bind();
  shop.bind(server.lease());
  await vi.waitFor(() => {
    expect(shop.view().kind).toBe("ready");
  });
  server.failure = undefined;
  await shop.purchase("helmet-red", 120);

  expect(server.orders.map(({ requestId }) => requestId)).toEqual(["r1", "r1"]);
});

it("drops open request ids when another account signs in", async () => {
  const { server, shop } = await readyShop();

  server.failure = new PrivateRequestError("retry");
  await shop.purchase("helmet-red", 120);
  shop.bind();
  shop.bind(server.lease("other-rider"));
  await vi.waitFor(() => {
    expect(shop.view().kind).toBe("ready");
  });
  server.failure = undefined;
  await shop.purchase("helmet-red", 120);

  expect(server.orders.map(({ requestId }) => requestId)).toEqual(["r1", "r2"]);
});

it("treats a receipt for another item as a final rejection", async () => {
  const { server, shop } = await readyShop();

  server.failure = new ShopReceiptMismatch();
  await shop.purchase("helmet-red", 120);
  server.failure = undefined;
  await shop.purchase("helmet-red", 120);

  expect(server.orders.map(({ requestId }) => requestId)).toEqual(["r1", "r2"]);
});
