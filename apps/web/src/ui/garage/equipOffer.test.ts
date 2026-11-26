import { expect, it } from "vitest";

import {
  DEFAULT_AVATAR_CONFIG,
  avatarItemsForSlot,
  defaultInventoryItemIds,
} from "@voltonaut/rules";
import type { AvatarConfig, ItemDef } from "@voltonaut/shared";

import type { GarageLoadoutView } from "../../sync/garageLoadout.js";
import type { GarageShopView } from "../../sync/garageShop.js";
import {
  equipOffer,
  garageItemStatus,
  itemStatusText,
  ownedItemIds,
  sameLoadout,
} from "./equipOffer.js";
import { createInitialGarageState, garageReducer } from "./state.js";

function item(slot: ItemDef["slot"], id: string): ItemDef {
  const found = avatarItemsForSlot(slot).find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`Missing catalog item ${id}`);

  return found;
}

const OWNED = [...defaultInventoryItemIds(), "jersey.stripe"];

function shop(owned: readonly string[] = OWNED): GarageShopView {
  return {
    kind: "ready",
    voltsBalance: 0,
    ownedItemIds: owned,
    pendingItemId: null,
    message: "",
    messageItemId: null,
  };
}

function loadout(saving = false, value: AvatarConfig = DEFAULT_AVATAR_CONFIG): GarageLoadoutView {
  return { kind: "ready", loadout: value, saving, message: "" };
}

function selecting(id: string) {
  return garageReducer(createInitialGarageState(), {
    kind: "selectItem",
    slot: "jersey",
    item: item("jersey", id),
  });
}

it("names the four item states against the equipment", () => {
  const items = ["jersey.classic", "jersey.stripe", "jersey.aurora", "jersey.kom"].map((id) =>
    item("jersey", id),
  );

  const labels = items.map((entry) =>
    itemStatusText(entry, garageItemStatus(entry, OWNED, DEFAULT_AVATAR_CONFIG)),
  );

  expect(labels).toEqual(["Ausgerüstet", "Im Besitz", "20.000 ⚡", "Gesperrt"]);
  expect(ownedItemIds({ kind: "guest" })).toEqual(defaultInventoryItemIds());
});

it("hides equipping for guests and waits for shop and loadout", () => {
  const state = selecting("jersey.stripe");

  expect(equipOffer(state, { kind: "guest" }, { kind: "guest" }).visible).toBe(false);
  expect(equipOffer(state, shop(), { kind: "loading" })).toMatchObject({
    visible: false,
    hint: "Ausrüstung wird geladen …",
  });
  expect(equipOffer(state, { kind: "loading" }, loadout()).visible).toBe(false);
});

it("equips an owned item and saves the selection on top of the equipment", () => {
  const offer = equipOffer(selecting("jersey.stripe"), shop(), loadout());

  expect(offer).toMatchObject({ visible: true, equipText: "Ausrüsten", equipEnabled: true });
  expect(offer.target.rider.jerseyId).toBe("jersey.stripe");
  expect(offer.target.bike).toEqual(DEFAULT_AVATAR_CONFIG.bike);
  expect(offer.discardEnabled).toBe(true);
});

it("shows the equipped item as such and blocks buyable, locked and saving states", () => {
  expect(equipOffer(createInitialGarageState(), shop(), loadout())).toMatchObject({
    equipText: "Ausgerüstet",
    equipEnabled: false,
    discardEnabled: false,
  });
  expect(equipOffer(selecting("jersey.aurora"), shop(), loadout())).toMatchObject({
    equipEnabled: false,
    hint: "Erst kaufen, dann ausrüsten.",
  });
  expect(equipOffer(selecting("jersey.kom"), shop(), loadout()).hint).toContain("Gesperrt:");
  expect(equipOffer(selecting("jersey.stripe"), shop(), loadout(true))).toMatchObject({
    equipText: "Wird gespeichert …",
    equipEnabled: false,
    discardEnabled: false,
  });
});

it("returns to the confirmed equipment and keeps its colors", () => {
  const equipped: AvatarConfig = {
    ...DEFAULT_AVATAR_CONFIG,
    rider: {
      ...DEFAULT_AVATAR_CONFIG.rider,
      jerseyId: "jersey.stripe",
      jerseyColors: ["#45c4b0", "#202830"],
    },
  };

  const confirmed = garageReducer(selecting("jersey.classic"), {
    kind: "loadoutConfirmed",
    loadout: equipped,
  });

  expect(confirmed.config).toEqual(equipped);
  expect(confirmed.selection.item.id).toBe("jersey.stripe");
  expect(confirmed.selection.colors).toEqual(["#45c4b0", "#202830"]);

  const discarded = garageReducer(
    garageReducer(confirmed, { kind: "selectColor", index: 0, color: "#ffd60a" }),
    { kind: "discardPreview" },
  );

  expect(discarded.config).toEqual(equipped);
});

it("saves the whole preview across slots when every item in it is owned", () => {
  const jersey = selecting("jersey.stripe");

  const helmet = garageReducer(garageReducer(jersey, { kind: "selectSlot", slot: "helmet" }), {
    kind: "selectColor",
    index: 0,
    color: "#202830",
  });

  const offer = equipOffer(helmet, shop(), loadout());

  expect(offer.target.rider.jerseyId).toBe("jersey.stripe");
  expect(offer.target.rider.helmetColor).toBe("#202830");

  const withLocked = garageReducer(garageReducer(helmet, { kind: "selectSlot", slot: "jersey" }), {
    kind: "selectItem",
    slot: "jersey",
    item: item("jersey", "jersey.aurora"),
  });

  expect(equipOffer(withLocked, shop(), loadout()).equipEnabled).toBe(false);
});

it("compares loadouts independent of key order", () => {
  const reordered: AvatarConfig = {
    bike: DEFAULT_AVATAR_CONFIG.bike,
    rider: DEFAULT_AVATAR_CONFIG.rider,
  };

  expect(sameLoadout(reordered, DEFAULT_AVATAR_CONFIG)).toBe(true);
  expect(sameLoadout(selecting("jersey.stripe").config, DEFAULT_AVATAR_CONFIG)).toBe(false);
});
