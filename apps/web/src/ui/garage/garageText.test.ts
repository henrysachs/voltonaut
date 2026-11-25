import { describe, expect, it } from "vitest";

import type { ItemDef, NonShopItemDef } from "@voltonaut/shared";

import { itemUnlockText, priceText, rarityText, slotText } from "./garageText.js";

const item: ItemDef = {
  id: "frame.aero",
  slot: "frame",
  name: "Aero",
  assetRef: "procedural://bike/frame/aero",
  colorable: 1,
  unlock: { kind: "shop", priceVolts: 6000, minLevel: 5 },
  priceVolts: 6000,
  rarity: "rare",
};

function withoutPrice(): NonShopItemDef {
  return {
    id: item.id,
    slot: item.slot,
    name: item.name,
    assetRef: item.assetRef,
    colorable: item.colorable,
    unlock: { kind: "default" },
    rarity: item.rarity,
  };
}

describe("garage text", () => {
  it("labels every slot and rarity", () => {
    expect(slotText("skin")).toBe("Haut");
    expect(slotText("jersey")).toBe("Trikot");
    expect(slotText("helmet")).toBe("Helm");
    expect(slotText("shoes")).toBe("Schuhe");
    expect(slotText("glasses")).toBe("Brille");
    expect(slotText("frame")).toBe("Rahmen");
    expect(slotText("wheels")).toBe("Laufräder");
    expect(rarityText("common")).toBe("Common");
    expect(rarityText("rare")).toBe("Rare");
    expect(rarityText("epic")).toBe("Epic");
    expect(rarityText("legendary")).toBe("Legendary");
  });

  it("describes each unlock rule without claiming ownership", () => {
    expect(itemUnlockText(withoutPrice())).toBe("Standard");
    expect(itemUnlockText({ ...withoutPrice(), unlock: { kind: "level", level: 5 } })).toBe(
      "Ab Level 5",
    );
    expect(
      itemUnlockText({ ...withoutPrice(), unlock: { kind: "badge", badgeId: "kom-hunter" } }),
    ).toBe("Badge kom-hunter");
    expect(itemUnlockText({ ...withoutPrice(), unlock: { kind: "distanceTotal", km: 100 } })).toBe(
      "100 km Gesamtstrecke",
    );
    expect(itemUnlockText(item)).toBe("Shop · ab Level 5 (Prüfung folgt)");
    expect(
      itemUnlockText({ ...item, unlock: { kind: "shop", priceVolts: 1500 }, priceVolts: 1500 }),
    ).toBe("Shop");
  });

  it("names the season and tier of a season reward", () => {
    expect(
      itemUnlockText({
        ...withoutPrice(),
        unlock: { kind: "season", seasonId: "season-01", tier: 12 },
      }),
    ).toBe("Saison 01 · Stufe 12");
  });

  it("shows catalog prices", () => {
    expect(priceText(item)).toBe("6.000 ⚡");
    expect(priceText(withoutPrice())).toBe("Kein Kauf");
  });
});
