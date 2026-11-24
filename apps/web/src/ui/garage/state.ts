import { DEFAULT_AVATAR_CONFIG, avatarItemForSlot, previewAvatarConfig } from "@voltonaut/rules";
import {
  AvatarColorSchema,
  GaragePreviewSelectionSchema,
  GarageUnavailable3dSelectionSchema,
  type AvatarColor,
  type AvatarConfig,
  type AvatarSlot,
  type GaragePreviewSelection,
  type GarageSelection,
  type ItemDef,
} from "@voltonaut/shared";

import { defaultPreviewColors } from "./palettes.js";

export type GarageUnavailable3dSelection = Extract<GarageSelection, { kind: "unavailable3d" }>;

export type GarageState =
  | {
      readonly kind: "preview";
      readonly selection: GaragePreviewSelection;
      readonly config: AvatarConfig;
    }
  | {
      readonly kind: "unavailable3d";
      readonly selection: GarageUnavailable3dSelection;
      readonly config: AvatarConfig;
    };

export type GarageAction =
  | { readonly kind: "selectSlot"; readonly slot: AvatarSlot }
  | { readonly kind: "selectItem"; readonly slot: AvatarSlot; readonly item: ItemDef }
  | { readonly kind: "selectColor"; readonly index: number; readonly color: string }
  | { readonly kind: "previewUnavailable" };

type SlotAction = Extract<GarageAction, { kind: "selectSlot" }>;

type ItemAction = Extract<GarageAction, { kind: "selectItem" }>;

type ColorAction = Extract<GarageAction, { kind: "selectColor" }>;

interface SelectionFields {
  readonly slot: AvatarSlot;
  readonly item: ItemDef;
  readonly colors: readonly AvatarColor[];
}

export function createInitialGarageState(slot: AvatarSlot = "jersey"): GarageState {
  const config: AvatarConfig = DEFAULT_AVATAR_CONFIG;
  const item = avatarItemForSlot(config, slot);

  const selection = GaragePreviewSelectionSchema.parse({
    kind: "preview",
    slot,
    item,
    colors: defaultPreviewColors(item),
  });

  return { kind: "preview", selection, config };
}

export function garageReducer(
  state: Readonly<GarageState>,
  action: Readonly<GarageAction>,
): GarageState {
  switch (action.kind) {
    case "selectSlot":
      return selectSlot(state, action);
    case "selectItem":
      return selectItem(state, action);
    case "selectColor":
      return selectColor(state, action);
    case "previewUnavailable":
      return previewUnavailable(state);
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported garage action: ${String(exhaustive)}`);
    }
  }
}

function selectSlot(state: Readonly<GarageState>, action: Readonly<SlotAction>): GarageState {
  const item = avatarItemForSlot(state.config, action.slot);

  return updateSelection(state, {
    slot: action.slot,
    item,
    colors: defaultPreviewColors(item),
  });
}

function selectItem(state: Readonly<GarageState>, action: Readonly<ItemAction>): GarageState {
  if (action.slot !== state.selection.slot || action.item.slot !== action.slot) return state;

  return updateSelection(state, {
    slot: action.slot,
    item: action.item,
    colors: defaultPreviewColors(action.item),
  });
}

function selectColor(state: Readonly<GarageState>, action: Readonly<ColorAction>): GarageState {
  const parsed = AvatarColorSchema.safeParse(action.color);

  if (
    !parsed.success ||
    !Number.isInteger(action.index) ||
    action.index < 0 ||
    action.index >= state.selection.colors.length
  ) {
    return state;
  }

  const colors = state.selection.colors.map((color, index) =>
    index === action.index ? parsed.data : color,
  );

  return updateSelection(state, { ...selectionFields(state), colors });
}

function previewUnavailable(state: Readonly<GarageState>): GarageState {
  if (state.kind === "unavailable3d") return state;

  const selection = GarageUnavailable3dSelectionSchema.parse({
    kind: "unavailable3d",
    reason: "webgl-unavailable",
    ...selectionFields(state),
  });

  return { kind: "unavailable3d", selection, config: state.config };
}

function selectionFields(state: Readonly<GarageState>): SelectionFields {
  return {
    slot: state.selection.slot,
    item: state.selection.item,
    colors: state.selection.colors,
  };
}

function updateSelection(
  state: Readonly<GarageState>,
  fields: Readonly<SelectionFields>,
): GarageState {
  const preview = GaragePreviewSelectionSchema.parse({ kind: "preview", ...fields });
  const config = previewAvatarConfig(state.config, preview);

  if (state.kind === "unavailable3d") {
    const selection = GarageUnavailable3dSelectionSchema.parse({
      kind: "unavailable3d",
      reason: "webgl-unavailable",
      ...fields,
    });

    return { kind: "unavailable3d", selection, config };
  }

  return { kind: "preview", selection: preview, config };
}
