import { afterEach, expect, it, vi } from "vitest";

import { avatarItemsForSlot } from "@voltonaut/rules";

import type { GarageShopView } from "../../sync/garageShop.js";
import { createTestDocument } from "../../testdata/dom.js";
import { GaragePurchase, type GarageShopSource } from "./purchase.js";

const item = avatarItemsForSlot("jersey").find((candidate) => candidate.id === "jersey.stripe");

if (item === undefined) throw new Error("Missing stripe jersey");

const stripe = item;

afterEach(() => vi.unstubAllGlobals());

interface PurchaseFixture {
  readonly purchase: GaragePurchase;
  readonly publish: ((view: GarageShopView) => void) | undefined;
}

function setupPurchase(): PurchaseFixture {
  const dom = createTestDocument();
  vi.stubGlobal("document", dom);

  let publish: ((view: GarageShopView) => void) | undefined;

  const source: GarageShopSource = {
    subscribe: (listener) => {
      publish = listener;
      listener({
        kind: "ready",
        voltsBalance: 2000,
        ownedItemIds: [],
        pendingItemId: null,
        message: "",
        messageItemId: null,
      });

      return () => {};
    },
    purchase: () => Promise.resolve(),
    retry: () => Promise.resolve(),
  };

  const purchase = new GaragePurchase();
  purchase.attach(source);
  purchase.show(stripe, true);

  return { purchase, publish };
}

it("uses the shared primary button style for an idle purchase", () => {
  const { purchase } = setupPurchase();

  expect(purchase.button.getAttribute("class")).toBe("btn btn--primary garage__purchase");
  expect(purchase.button.getAttribute("aria-busy")).toBe("false");
  expect(purchase.button.disabled).toBe(false);
});

it("marks the item whose purchase is pending as busy", () => {
  const { purchase, publish } = setupPurchase();

  publish?.({
    kind: "ready",
    voltsBalance: 2000,
    ownedItemIds: [],
    pendingItemId: stripe.id,
    message: "Kauf wird bestätigt …",
    messageItemId: stripe.id,
  });
  expect(purchase.button.getAttribute("aria-busy")).toBe("true");
  expect(purchase.button.disabled).toBe(true);
});

it("clears busy state while another item keeps the purchase control unavailable", () => {
  const { purchase, publish } = setupPurchase();

  publish?.({
    kind: "ready",
    voltsBalance: 2000,
    ownedItemIds: [],
    pendingItemId: "jersey.tempo",
    message: "Kauf wird bestätigt …",
    messageItemId: "jersey.tempo",
  });
  expect(purchase.button.getAttribute("aria-busy")).toBe("false");
  expect(purchase.button.disabled).toBe(true);
});
