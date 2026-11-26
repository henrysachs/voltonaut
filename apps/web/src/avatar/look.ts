import { SEASON_AVATAR_ITEMS, START_AVATAR_CATALOG } from "@voltonaut/rules";
import { AvatarConfigSchema, type AvatarConfig, type ItemDef } from "@voltonaut/shared";

import { frameSpecFor, wheelSpecFor, type FrameSpec, type WheelSpec } from "./bikeSpecs.js";
import {
  glassesSpecFor,
  helmetSpecFor,
  jerseySpecFor,
  shoeSpecFor,
  type RiderKit,
} from "./riderSpecs.js";

export interface AvatarLook {
  readonly frame: FrameSpec;
  readonly wheels: WheelSpec;
  readonly kit: RiderKit;
}

const AVATAR_ITEMS: readonly Readonly<ItemDef>[] = [
  ...START_AVATAR_CATALOG,
  ...SEASON_AVATAR_ITEMS,
];

function assetRefOf(itemId: string, catalog: readonly Readonly<ItemDef>[]): string | undefined {
  return catalog.find((item) => item.id === itemId)?.assetRef;
}

/** Resolves catalog items to render specs through their `assetRef`; unknown items fall back to defaults. */
export function avatarLook(
  config: Readonly<AvatarConfig>,
  catalog: readonly Readonly<ItemDef>[] = AVATAR_ITEMS,
): AvatarLook {
  const { rider, bike } = config;

  return {
    frame: frameSpecFor(assetRefOf(bike.frameId, catalog)),
    wheels: wheelSpecFor(assetRefOf(bike.wheelsId, catalog)),
    kit: {
      jersey: jerseySpecFor(assetRefOf(rider.jerseyId, catalog)),
      helmet: helmetSpecFor(assetRefOf(rider.helmetId, catalog)),
      shoes: shoeSpecFor(assetRefOf(rider.shoesId, catalog)),
      glasses: glassesSpecFor(assetRefOf(rider.glassesId, catalog)),
    },
  };
}

/**
 * Equal looks; the schema fixes the key order of both sides. The ride ignores an unchanged look,
 * so a guest's repeated default never rebuilds bike and body mid-ride (issue #142, a mitigation).
 */
export function sameAvatarLook(
  left: Readonly<AvatarConfig>,
  right: Readonly<AvatarConfig>,
): boolean {
  return (
    JSON.stringify(AvatarConfigSchema.parse(left)) ===
    JSON.stringify(AvatarConfigSchema.parse(right))
  );
}
