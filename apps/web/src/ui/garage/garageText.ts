import type { AvatarRarity, AvatarSlot, ItemDef } from "@voltonaut/shared";

const VOLTS_FORMAT = new Intl.NumberFormat("de-DE");

const SLOT_LABELS: Readonly<Record<AvatarSlot, string>> = {
  skin: "Haut",
  jersey: "Trikot",
  helmet: "Helm",
  shoes: "Schuhe",
  glasses: "Brille",
  frame: "Rahmen",
  wheels: "Laufräder",
};

const RARITY_LABELS: Readonly<Record<AvatarRarity, string>> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function slotText(slot: AvatarSlot): string {
  return SLOT_LABELS[slot];
}

export function rarityText(rarity: AvatarRarity): string {
  return RARITY_LABELS[rarity];
}

export function itemUnlockText(item: ItemDef): string {
  switch (item.unlock.kind) {
    case "default":
      return "Standard";
    case "level":
      return `Ab Level ${item.unlock.level}`;
    case "badge":
      return `Badge ${item.unlock.badgeId}`;
    case "distanceTotal":
      return `${VOLTS_FORMAT.format(item.unlock.km)} km Gesamtstrecke`;
    case "shop":
      // Transition (spec E7-02): the server does not check levels until progression exists.
      return item.unlock.minLevel === undefined
        ? "Shop"
        : `Shop · ab Level ${item.unlock.minLevel} (Prüfung folgt)`;
    case "season":
      return `Saison ${item.unlock.seasonId.replace("season-", "")} · Stufe ${item.unlock.tier}`;
    default: {
      const exhaustive: never = item.unlock;
      throw new Error(`Unsupported unlock rule: ${String(exhaustive)}`);
    }
  }
}

export function priceText(item: ItemDef): string {
  return item.priceVolts === undefined ? "Kein Kauf" : `${VOLTS_FORMAT.format(item.priceVolts)} ⚡`;
}
