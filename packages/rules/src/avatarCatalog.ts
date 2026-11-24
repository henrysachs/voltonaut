import {
  AvatarConfigSchema,
  AvatarSlotSchema,
  GarageSelectionSchema,
  type AvatarConfig,
  type AvatarSlot,
  type GarageSelection,
  type ItemDef,
} from "@voltonaut/shared";

import { AVATAR_SLOTS, DEFAULT_AVATAR_CONFIG, START_AVATAR_CATALOG } from "./avatarCatalogData.js";

export { AVATAR_SLOTS, DEFAULT_AVATAR_CONFIG, START_AVATAR_CATALOG };

export function avatarItemsForSlot(slot: AvatarSlot): readonly ItemDef[] {
  const parsedSlot = AvatarSlotSchema.parse(slot);

  return START_AVATAR_CATALOG.filter((item) => item.slot === parsedSlot);
}

export function avatarItemIdForSlot(config: Readonly<AvatarConfig>, slot: AvatarSlot): string {
  const parsed = AvatarConfigSchema.parse(config);

  switch (slot) {
    case "skin":
      return skinItemForTone(parsed.rider.skinTone);
    case "jersey":
      return parsed.rider.jerseyId;
    case "helmet":
      return parsed.rider.helmetId;
    case "shoes":
      return parsed.rider.shoesId;
    case "glasses":
      return parsed.rider.glassesId;
    case "frame":
      return parsed.bike.frameId;
    case "wheels":
      return parsed.bike.wheelsId;
    default: {
      const exhaustive: never = slot;
      throw new Error(`Unsupported avatar slot: ${String(exhaustive)}`);
    }
  }
}

export function avatarItemForSlot(config: Readonly<AvatarConfig>, slot: AvatarSlot): ItemDef {
  const id = avatarItemIdForSlot(config, slot);
  const item = START_AVATAR_CATALOG.find((candidate) => candidate.id === id);

  if (item === undefined) throw new Error(`Missing avatar item: ${id}`);

  return item;
}

export function previewAvatarConfig(
  config: Readonly<AvatarConfig>,
  selection: Readonly<GarageSelection>,
): AvatarConfig {
  const current = AvatarConfigSchema.parse(config);
  const parsed = GarageSelectionSchema.parse(selection);

  switch (parsed.item.slot) {
    case "skin":
    case "jersey":
    case "helmet":
    case "shoes":
    case "glasses":
      return previewRider(current, parsed);
    case "frame":
    case "wheels":
      return previewBike(current, parsed);
    default: {
      const exhaustive: never = parsed.item.slot;
      throw new Error(`Unsupported avatar slot: ${String(exhaustive)}`);
    }
  }
}

function previewRider(current: AvatarConfig, selection: Readonly<GarageSelection>): AvatarConfig {
  const { item, colors } = selection;
  const primary = colors[0];

  switch (item.slot) {
    case "skin":
      return AvatarConfigSchema.parse({
        ...current,
        rider: { ...current.rider, skinTone: skinToneForItem(item.id, current.rider.skinTone) },
      });
    case "jersey":
      return AvatarConfigSchema.parse({
        ...current,
        rider: {
          ...current.rider,
          jerseyId: item.id,
          jerseyColors: [
            primary ?? current.rider.jerseyColors[0],
            colors[1] ?? current.rider.jerseyColors[1],
          ],
        },
      });
    case "helmet":
      return AvatarConfigSchema.parse({
        ...current,
        rider: {
          ...current.rider,
          helmetId: item.id,
          helmetColor: primary ?? current.rider.helmetColor,
        },
      });
    case "shoes":
      return AvatarConfigSchema.parse({
        ...current,
        rider: { ...current.rider, shoesId: item.id },
      });
    case "glasses":
      return AvatarConfigSchema.parse({
        ...current,
        rider: { ...current.rider, glassesId: item.id },
      });
    case "frame":
    case "wheels":
      throw new Error("Unsupported rider slot");
    default:
      throw new Error("Unsupported rider slot");
  }
}

function previewBike(current: AvatarConfig, selection: Readonly<GarageSelection>): AvatarConfig {
  const { item, colors } = selection;
  const primary = colors[0];

  switch (item.slot) {
    case "frame":
      return AvatarConfigSchema.parse({
        ...current,
        bike: {
          ...current.bike,
          frameId: item.id,
          frameColor: primary ?? current.bike.frameColor,
        },
      });
    case "wheels":
      return AvatarConfigSchema.parse({
        ...current,
        bike: { ...current.bike, wheelsId: item.id },
      });
    case "skin":
    case "jersey":
    case "helmet":
    case "shoes":
    case "glasses":
      throw new Error("Unsupported bike slot");
    default:
      throw new Error("Unsupported bike slot");
  }
}

function skinToneForItem(itemId: string, fallback: string): string {
  switch (itemId) {
    case "skin.01":
      return "#f1c7a5";
    case "skin.02":
      return "#e7cbb7";
    case "skin.03":
      return "#c98d68";
    case "skin.04":
      return "#98664f";
    case "skin.05":
      return "#b77b4f";
    case "skin.06":
      return "#654638";
    default:
      return fallback;
  }
}

function skinItemForTone(tone: string): string {
  switch (tone) {
    case "#f1c7a5":
      return "skin.01";
    case "#e7cbb7":
      return "skin.02";
    case "#c98d68":
      return "skin.03";
    case "#98664f":
      return "skin.04";
    case "#b77b4f":
      return "skin.05";
    case "#654638":
      return "skin.06";
    default:
      return "skin.03";
  }
}
