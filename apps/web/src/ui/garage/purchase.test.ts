import { afterEach, expect, it, vi } from "vitest";

import { avatarItemsForSlot } from "@voltonaut/rules";

import type { GarageShopView } from "../../sync/garageShop.js";
import { createTestDocument, type TestElement } from "../../testdata/dom.js";
import { GaragePurchase, type GarageShopSource } from "./purchase.js";

const item = avatarItemsForSlot("jersey").find((candidate) => candidate.id === "jersey.stripe");

if (item === undefined) throw new Error("Missing stripe jersey");

const stripe = item;

const otherJersey = avatarItemsForSlot("jersey").find((candidate) => candidate.id !== stripe.id);

if (otherJersey === undefined) throw new Error("Missing a second jersey");

const OTHER_JERSEY = otherJersey;

afterEach(() => vi.unstubAllGlobals());

interface PurchaseFixture {
  readonly purchase: GaragePurchase;
  readonly publish: ((view: GarageShopView) => void) | undefined;
  readonly dom: ReturnType<typeof createTestDocument>;
}

/** `pendingView` is published synchronously like the shop, which marks the purchase pending before awaiting. */
function setupPurchase(pendingView?: GarageShopView): PurchaseFixture {
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
    purchase: () => {
      if (pendingView !== undefined) publish?.(pendingView);

      return Promise.resolve();
    },
    retry: () => Promise.resolve(),
  };

  const purchase = new GaragePurchase();
  purchase.attach(source);
  purchase.show(stripe, true);

  return { purchase, publish, dom };
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

const READY: GarageShopView = {
  kind: "ready",
  voltsBalance: 2000,
  ownedItemIds: [],
  pendingItemId: null,
  message: "",
  messageItemId: null,
};

const PENDING: GarageShopView = {
  ...READY,
  pendingItemId: stripe.id,
  message: "Kauf wird bestätigt …",
  messageItemId: stripe.id,
};

/* oxlint-disable typescript/prefer-readonly-parameter-types -- The DOM fake hands out live, mutable test nodes. */
function confirmButton(dom: ReturnType<typeof createTestDocument>): TestElement {
  const found = dom.created.find(
    (node: TestElement) => node.dataset["testid"] === "garage-purchase-confirm",
  );

  if (found === undefined) throw new Error("Missing confirm button");

  return found;
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */

/** Opens the confirmation and confirms it; the shop reports the purchase as pending. */
function buying() {
  const fixture = setupPurchase(PENDING);

  fixture.purchase.button.click();
  confirmButton(fixture.dom).click();

  return fixture;
}

it("keeps the confirmation locked in place while its purchase is pending", () => {
  const { purchase, dom } = buying();

  expect(purchase.confirmation.hidden).toBe(false);
  expect(confirmButton(dom).disabled).toBe(true);
  expect(confirmButton(dom).textContent).toBe("Kauf wird bestätigt …");
});

it.each([
  ["a logout", { kind: "guest" }],
  ["an account switch", { kind: "loading" }],
  ["a failed shop read", { kind: "failed", message: "Shop nicht erreichbar." }],
] as const)("closes a pending confirmation on %s and unlocks the next one", (_label, view) => {
  const { purchase, publish, dom } = buying();

  publish?.(view);

  expect(purchase.confirmation.hidden).toBe(true);

  publish?.(READY);
  purchase.button.click();

  expect(purchase.confirmation.hidden).toBe(false);
  expect(confirmButton(dom).disabled).toBe(false);
});

it("closes a pending confirmation when the rider selects another item", () => {
  const { purchase, publish, dom } = buying();
  purchase.show(OTHER_JERSEY, true);

  expect(purchase.confirmation.hidden).toBe(true);

  publish?.(READY);
  purchase.show(stripe, true);
  purchase.button.click();

  expect(confirmButton(dom).disabled).toBe(false);
});
