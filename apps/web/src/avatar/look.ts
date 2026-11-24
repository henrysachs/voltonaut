import { START_AVATAR_CATALOG } from "@voltonaut/rules";
import type { AvatarConfig, ItemDef } from "@voltonaut/shared";

import { frameSpecFor, wheelSpecFor, type FrameSpec, type WheelSpec } from "./bikeSpecs.js";

export interface AvatarLook {
  readonly frame: FrameSpec;
  readonly wheels: WheelSpec;
  readonly shoeColor: number;
  readonly glassesVisible: boolean;
  readonly jerseyAccentRadiusM: number;
  readonly jerseyAccentRoughness: number;
}

function assetRefOf(itemId: string, catalog: readonly Readonly<ItemDef>[]): string | undefined {
  return catalog.find((item) => item.id === itemId)?.assetRef;
}

/** Resolves catalog items to render specs through their `assetRef`; unknown items fall back to defaults. */
export function avatarLook(
  config: Readonly<AvatarConfig>,
  catalog: readonly Readonly<ItemDef>[] = START_AVATAR_CATALOG,
): AvatarLook {
  return {
    frame: frameSpecFor(assetRefOf(config.bike.frameId, catalog)),
    wheels: wheelSpecFor(assetRefOf(config.bike.wheelsId, catalog)),
    shoeColor: config.rider.shoesId === "shoes.white" ? 0xf5ebca : 0x18272e,
    glassesVisible: config.rider.glassesId !== "glasses.none",
    ...jerseyAccentLook(config.rider.jerseyId),
  };
}

function jerseyAccentLook(
  jerseyId: string,
): Pick<AvatarLook, "jerseyAccentRadiusM" | "jerseyAccentRoughness"> {
  switch (jerseyId) {
    case "jersey.stripe":
      return { jerseyAccentRadiusM: 0.158, jerseyAccentRoughness: 0.65 };
    case "jersey.tempo":
      return { jerseyAccentRadiusM: 0.148, jerseyAccentRoughness: 0.9 };
    case "jersey.kom":
      return { jerseyAccentRadiusM: 0.162, jerseyAccentRoughness: 0.55 };
    case "jersey.century":
      return { jerseyAccentRadiusM: 0.155, jerseyAccentRoughness: 0.8 };
    case "jersey.aurora":
      return { jerseyAccentRadiusM: 0.17, jerseyAccentRoughness: 0.45 };
    default:
      return { jerseyAccentRadiusM: 0.152, jerseyAccentRoughness: 0.85 };
  }
}
