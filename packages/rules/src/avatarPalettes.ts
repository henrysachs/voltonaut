import {
  AvatarSlotSchema,
  type AvatarColor,
  type AvatarSlot,
  type ItemDef,
} from "@voltonaut/shared";

/** Colors the garage offers and the server accepts per slot (spec E7-05). */
const AVATAR_PALETTES: Readonly<Record<AvatarSlot, readonly AvatarColor[]>> = {
  skin: ["#f1c7a5", "#e7cbb7", "#c98d68", "#98664f", "#b77b4f", "#654638"],
  jersey: ["#ec6b48", "#f5ebca", "#45c4b0", "#7b61ff", "#ffd60a", "#202830"],
  helmet: ["#f5ebca", "#45c4b0", "#ec6b48", "#202830"],
  shoes: ["#f5ebca", "#202830", "#ec6b48"],
  glasses: ["#202830", "#7b61ff", "#45c4b0"],
  frame: ["#f0a83b", "#45c4b0", "#ec6b48", "#7b61ff", "#202830"],
  wheels: ["#d3dadb", "#58666b", "#263238"],
};

export function avatarColorOptions(slot: AvatarSlot): readonly AvatarColor[] {
  return AVATAR_PALETTES[AvatarSlotSchema.parse(slot)];
}

export function defaultAvatarColors(item: Readonly<ItemDef>): AvatarColor[] {
  return avatarColorOptions(item.slot).slice(0, item.colorable);
}

/** Exact palette membership; the catalog spells every color in lowercase `#rrggbb`. */
export function isAvatarColorOption(slot: AvatarSlot, color: string): boolean {
  return avatarColorOptions(slot).includes(color);
}
