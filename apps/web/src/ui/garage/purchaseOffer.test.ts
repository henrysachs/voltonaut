import { expect, it } from "vitest";

import { avatarItemsForSlot } from "@voltonaut/rules";
import type { ItemDef } from "@voltonaut/shared";

import type { GarageShopView } from "../../sync/garageShop.js";
import { purchaseConfirmation, purchaseOffer } from "./purchaseOffer.js";

function jersey(id: string): ItemDef {
  const item = avatarItemsForSlot("jersey").find((candidate) => candidate.id === id);

  if (item === undefined) throw new Error(`Missing catalog item ${id}`);

  return item;
}

const stripe = jersey("jersey.stripe");
const classic = jersey("jersey.classic");

function ready(patch: Partial<Extract<GarageShopView, { kind: "ready" }>> = {}): GarageShopView {
  return {
    kind: "ready",
    voltsBalance: 2000,
    ownedItemIds: ["jersey.classic"],
    pendingItemId: null,
    message: "",
    messageItemId: null,
    ...patch,
  };
}

it("keeps guests, loading and failed shops on the preview", () => {
  expect(purchaseOffer(stripe, { kind: "guest" })).toEqual({
    buttonText: "Kauf nicht verfügbar",
    enabled: false,
    hint: "Zum Kaufen anmelden. Bis dahin nur Vorschau.",
  });
  expect(purchaseOffer(classic, { kind: "loading" })).toMatchObject({
    buttonText: "Nicht käuflich",
    enabled: false,
  });
  expect(purchaseOffer(stripe, { kind: "failed", message: "weg" })).toMatchObject({
    enabled: false,
    hint: "weg",
  });
});

it("enables buying only for a shop item the balance covers", () => {
  expect(purchaseOffer(stripe, ready())).toEqual({
    buttonText: "Kaufen (1.500 ⚡)",
    enabled: true,
    hint: "Guthaben: 2.000 ⚡.",
  });
  expect(purchaseOffer(stripe, ready({ voltsBalance: 1500 })).enabled).toBe(true);
  expect(purchaseOffer(stripe, ready({ voltsBalance: 1499 }))).toEqual({
    buttonText: "Kaufen (1.500 ⚡)",
    enabled: false,
    hint: "Zu wenig Volts: 1.499 ⚡ vorhanden.",
  });
});

it("shows owned, unsellable and pending items as not buyable", () => {
  expect(purchaseOffer(classic, ready())).toEqual({
    buttonText: "Im Besitz",
    enabled: false,
    hint: "Gehört deinem Konto.",
  });
  expect(
    purchaseOffer(stripe, ready({ ownedItemIds: ["jersey.stripe"], message: "Gekauft." })),
  ).toMatchObject({ buttonText: "Im Besitz", hint: "Gehört deinem Konto. Gekauft." });
  expect(purchaseOffer(classic, ready({ ownedItemIds: [] }))).toMatchObject({
    buttonText: "Nicht käuflich",
    enabled: false,
  });
  expect(purchaseOffer(stripe, ready({ pendingItemId: "jersey.stripe", message: "…" }))).toEqual({
    buttonText: "Kaufen (1.500 ⚡)",
    enabled: false,
    hint: "…",
  });
});

it("appends the shop message to the balance hint", () => {
  expect(purchaseOffer(stripe, ready({ message: "Abgelehnt." })).hint).toBe(
    "Guthaben: 2.000 ⚡. Abgelehnt.",
  );
});

it("shows a purchase message only on the item it is about", () => {
  const view = ready({ message: "Gekauft.", messageItemId: "jersey.tempo" });

  expect(purchaseOffer(stripe, view).hint).toBe("Guthaben: 2.000 ⚡.");
  expect(purchaseOffer(classic, view).hint).toBe("Gehört deinem Konto.");
});

it("confirms only an enabled offer and names price and balance afterwards", () => {
  expect(purchaseConfirmation(stripe, ready())).toEqual({
    priceVolts: 1500,
    question:
      "„Blitzstreifen“ für 1.500 ⚡ kaufen? Kontostand danach: 500 ⚡. Käufe sind endgültig und lassen sich nicht rückgängig machen.",
    confirmText: "Ja, für 1.500 ⚡ kaufen",
  });
  expect(purchaseConfirmation(stripe, ready({ voltsBalance: 1500 }))?.question).toContain(
    "Kontostand danach: 0 ⚡.",
  );
});

it("offers no confirmation for guests, owned, unaffordable, pending or unsellable items", () => {
  expect(purchaseConfirmation(stripe, { kind: "guest" })).toBeNull();
  expect(purchaseConfirmation(stripe, ready({ ownedItemIds: ["jersey.stripe"] }))).toBeNull();
  expect(purchaseConfirmation(stripe, ready({ voltsBalance: 1499 }))).toBeNull();
  expect(purchaseConfirmation(stripe, ready({ pendingItemId: "jersey.tempo" }))).toBeNull();
  expect(purchaseConfirmation(classic, ready({ ownedItemIds: [] }))).toBeNull();
});
