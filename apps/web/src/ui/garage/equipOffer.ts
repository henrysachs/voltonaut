import {
  AVATAR_SLOTS,
  avatarItemIdForSlot,
  defaultInventoryItemIds,
  previewAvatarConfig,
} from "@voltonaut/rules";
import { AvatarConfigSchema, type AvatarConfig, type ItemDef } from "@voltonaut/shared";

import type { GarageLoadoutView } from "../../sync/garageLoadout.js";
import type { GarageShopView } from "../../sync/garageShop.js";
import { itemUnlockText } from "./garageText.js";
import type { GarageState } from "./state.js";

const VOLTS_FORMAT = new Intl.NumberFormat("de-DE");

export type GarageItemStatus = "equipped" | "owned" | "buyable" | "locked";

/** Owned items from the server; guests and offline riders own only the catalog defaults. */
export function ownedItemIds(shop: GarageShopView): readonly string[] {
  return shop.kind === "ready" ? shop.ownedItemIds : defaultInventoryItemIds();
}

/** The four item states of spec E7-05 AK6, against the confirmed equipment. */
export function garageItemStatus(
  item: Readonly<ItemDef>,
  owned: readonly string[],
  equipped: Readonly<AvatarConfig>,
): GarageItemStatus {
  if (avatarItemIdForSlot(equipped, item.slot) === item.id) return "equipped";

  if (owned.includes(item.id)) return "owned";

  return item.unlock.kind === "shop" ? "buyable" : "locked";
}

export function itemStatusText(item: Readonly<ItemDef>, status: GarageItemStatus): string {
  switch (status) {
    case "equipped":
      return "Ausgerüstet";
    case "owned":
      return "Im Besitz";
    case "buyable":
      return item.priceVolts === undefined ? "Shop" : `${VOLTS_FORMAT.format(item.priceVolts)} ⚡`;
    case "locked":
      return "Gesperrt";
    default: {
      const exhaustive: never = status;
      throw new Error(`Unsupported item status: ${String(exhaustive)}`);
    }
  }
}

export interface EquipOffer {
  /** `false` for guests: the garage then shows the preview only. */
  readonly visible: boolean;
  readonly equipText: string;
  readonly equipEnabled: boolean;
  /** Loadout to save when „Ausrüsten“ is clicked. */
  readonly target: AvatarConfig;
  readonly discardEnabled: boolean;
  readonly hint: string;
}

/** Equal loadouts; the schema fixes the key order, so the comparison does not depend on it. */
export function sameLoadout(left: Readonly<AvatarConfig>, right: Readonly<AvatarConfig>): boolean {
  return (
    JSON.stringify(AvatarConfigSchema.parse(left)) ===
    JSON.stringify(AvatarConfigSchema.parse(right))
  );
}

const same = sameLoadout;

/** What „Ausrüsten“ saves: the whole preview when every item in it is owned, else the selection. */
function equipTarget(state: Readonly<GarageState>, owned: readonly string[]): AvatarConfig {
  const wearable = AVATAR_SLOTS.every((slot) =>
    owned.includes(avatarItemIdForSlot(state.config, slot)),
  );

  return wearable ? state.config : previewAvatarConfig(state.equipped, state.selection);
}

function hidden(state: Readonly<GarageState>, hint: string): EquipOffer {
  return {
    visible: false,
    equipText: "Ausrüsten",
    equipEnabled: false,
    target: state.equipped,
    discardEnabled: !same(state.config, state.equipped),
    hint,
  };
}

function blockedHint(item: Readonly<ItemDef>, status: GarageItemStatus): string {
  return status === "buyable"
    ? "Erst kaufen, dann ausrüsten."
    : `Gesperrt: ${itemUnlockText(item)}.`;
}

/**
 * What „Ausrüsten“ may do for the selected item (spec E7-05 AK6): only a signed-in rider with
 * a loaded shop and loadout equips, only owned items, and only when something changes.
 */
export function equipOffer(
  state: Readonly<GarageState>,
  shop: GarageShopView,
  loadout: GarageLoadoutView,
): EquipOffer {
  if (loadout.kind === "guest") return hidden(state, "");

  if (loadout.kind !== "ready" || shop.kind !== "ready")
    return hidden(state, loadout.kind === "failed" ? loadout.message : "Ausrüstung wird geladen …");

  const item = state.selection.item;
  const status = garageItemStatus(item, shop.ownedItemIds, state.equipped);
  const target = equipTarget(state, shop.ownedItemIds);
  const changed = !same(target, state.equipped);
  const wearable = status === "equipped" || status === "owned";

  return {
    visible: true,
    equipText: loadout.saving ? "Wird gespeichert …" : changed ? "Ausrüsten" : "Ausgerüstet",
    equipEnabled: wearable && changed && !loadout.saving,
    target,
    discardEnabled: !same(state.config, state.equipped) && !loadout.saving,
    hint: wearable ? loadout.message : blockedHint(item, status),
  };
}
