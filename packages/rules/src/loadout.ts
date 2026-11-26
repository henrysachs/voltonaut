import {
  LoadoutDecisionInputSchema,
  type AvatarSlot,
  type LoadoutDecisionInput,
} from "@voltonaut/shared";

import { AVATAR_SLOTS, START_AVATAR_CATALOG } from "./avatarCatalogData.js";
import { avatarItemIdForSlot } from "./avatarCatalog.js";
import { isAvatarColorOption } from "./avatarPalettes.js";

export type LoadoutDecision =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid_items"; readonly slots: readonly AvatarSlot[] }
  | { readonly kind: "invalid_colors"; readonly slots: readonly AvatarSlot[] }
  | { readonly kind: "not_owned"; readonly itemIds: readonly string[] };

type Loadout = LoadoutDecisionInput["loadout"];

/** Slots whose item is unknown or belongs to another slot. */
function invalidItemSlots(loadout: Readonly<Loadout>): readonly AvatarSlot[] {
  return AVATAR_SLOTS.filter((slot) => {
    const id = avatarItemIdForSlot(loadout, slot);

    return !START_AVATAR_CATALOG.some((item) => item.id === id && item.slot === slot);
  });
}

/** Slots with a color outside their palette; bar tape has no palette and is never accepted. */
function invalidColorSlots(loadout: Readonly<Loadout>): readonly AvatarSlot[] {
  const { rider, bike } = loadout;

  const colors: readonly (readonly [AvatarSlot, string])[] = [
    ["skin", rider.skinTone],
    ["jersey", rider.jerseyColors[0]],
    ["jersey", rider.jerseyColors[1]],
    ["helmet", rider.helmetColor],
    ["frame", bike.frameColor],
  ];

  const slots = colors.flatMap(([slot, color]) => (isAvatarColorOption(slot, color) ? [] : [slot]));

  if (bike.barTapeColor !== undefined) slots.push("frame");

  return [...new Set(slots)];
}

/**
 * Whether an account may wear a loadout (spec E7-05 AK2): every slot names a catalog item
 * of that slot, every color is in its palette and every item is owned.
 */
export function decideLoadout(input: LoadoutDecisionInput): LoadoutDecision {
  const parsed = LoadoutDecisionInputSchema.parse(input);
  const invalidItems = invalidItemSlots(parsed.loadout);

  if (invalidItems.length > 0) return { kind: "invalid_items", slots: invalidItems };

  const invalidColors = invalidColorSlots(parsed.loadout);

  if (invalidColors.length > 0) return { kind: "invalid_colors", slots: invalidColors };

  const missing = AVATAR_SLOTS.map((slot) => avatarItemIdForSlot(parsed.loadout, slot)).filter(
    (id) => !parsed.ownedItemIds.includes(id),
  );

  return missing.length === 0 ? { kind: "valid" } : { kind: "not_owned", itemIds: missing };
}
