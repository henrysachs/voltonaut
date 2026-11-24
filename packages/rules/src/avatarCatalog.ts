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
  const parsedSlot = AvatarSlotSchema.parse(slot);

  const itemIds: Readonly<Record<AvatarSlot, string>> = {
    skin: skinItemForTone(parsed.rider.skinTone),
    jersey: parsed.rider.jerseyId,
    helmet: parsed.rider.helmetId,
    shoes: parsed.rider.shoesId,
    glasses: parsed.rider.glassesId,
    frame: parsed.bike.frameId,
    wheels: parsed.bike.wheelsId,
  };

  return itemIds[parsedSlot];
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
  const { item, colors } = GarageSelectionSchema.parse(selection);

  switch (item.slot) {
    case "skin":
      return previewSkin(current, item.id);
    case "jersey":
      return previewJersey(current, item.id, colors);
    case "helmet":
      return previewHelmet(current, item.id, colors);
    case "shoes":
      return previewShoes(current, item.id);
    case "glasses":
      return previewGlasses(current, item.id);
    case "frame":
      return previewFrame(current, item.id, colors);
    case "wheels":
      return previewWheels(current, item.id);
    default: {
      const exhaustive: never = item.slot;
      throw new Error(`Unsupported avatar slot: ${String(exhaustive)}`);
    }
  }
}

function previewSkin(current: Readonly<AvatarConfig>, itemId: string): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    rider: { ...current.rider, skinTone: skinToneForItem(itemId, current.rider.skinTone) },
  });
}

function previewJersey(
  current: Readonly<AvatarConfig>,
  itemId: string,
  colors: readonly string[],
): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    rider: {
      ...current.rider,
      jerseyId: itemId,
      jerseyColors: [
        colors[0] ?? current.rider.jerseyColors[0],
        colors[1] ?? current.rider.jerseyColors[1],
      ],
    },
  });
}

function previewHelmet(
  current: Readonly<AvatarConfig>,
  itemId: string,
  colors: readonly string[],
): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    rider: {
      ...current.rider,
      helmetId: itemId,
      helmetColor: colors[0] ?? current.rider.helmetColor,
    },
  });
}

function previewShoes(current: Readonly<AvatarConfig>, itemId: string): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    rider: { ...current.rider, shoesId: itemId },
  });
}

function previewGlasses(current: Readonly<AvatarConfig>, itemId: string): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    rider: { ...current.rider, glassesId: itemId },
  });
}

function previewFrame(
  current: Readonly<AvatarConfig>,
  itemId: string,
  colors: readonly string[],
): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    bike: {
      ...current.bike,
      frameId: itemId,
      frameColor: colors[0] ?? current.bike.frameColor,
    },
  });
}

function previewWheels(current: Readonly<AvatarConfig>, itemId: string): AvatarConfig {
  return AvatarConfigSchema.parse({
    ...current,
    bike: { ...current.bike, wheelsId: itemId },
  });
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
