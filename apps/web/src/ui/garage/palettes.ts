import type { AvatarColor, AvatarSlot, ItemDef } from "@voltonaut/shared";

const PREVIEW_COLORS: Readonly<Record<AvatarSlot, readonly AvatarColor[]>> = {
  skin: ["#f1c7a5", "#e7cbb7", "#c98d68", "#98664f", "#b77b4f", "#654638"],
  jersey: ["#ec6b48", "#f5ebca", "#45c4b0", "#7b61ff", "#ffd60a", "#202830"],
  helmet: ["#f5ebca", "#45c4b0", "#ec6b48", "#202830"],
  shoes: ["#f5ebca", "#202830", "#ec6b48"],
  glasses: ["#202830", "#7b61ff", "#45c4b0"],
  frame: ["#f0a83b", "#45c4b0", "#ec6b48", "#7b61ff", "#202830"],
  wheels: ["#d3dadb", "#58666b", "#263238"],
};

export function previewColorOptions(slot: AvatarSlot): readonly AvatarColor[] {
  return PREVIEW_COLORS[slot];
}

export function defaultPreviewColors(item: ItemDef): AvatarColor[] {
  return PREVIEW_COLORS[item.slot].slice(0, item.colorable);
}
