import {
  DEFAULT_AVATAR_CONFIG,
  avatarItemForSlot,
  avatarItemIdForSlot,
  previewAvatarConfig,
  defaultAvatarColors,
} from "@voltonaut/rules";
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

export type GarageUnavailable3dSelection = Extract<GarageSelection, { kind: "unavailable3d" }>;

export type GarageState =
  | {
      readonly kind: "preview";
      readonly selection: GaragePreviewSelection;
      /** What the preview shows: the equipment plus unsaved changes. */
      readonly config: AvatarConfig;
      /** Server-confirmed equipment (spec E7-05); the default for guests. */
      readonly equipped: AvatarConfig;
    }
  | {
      readonly kind: "unavailable3d";
      readonly selection: GarageUnavailable3dSelection;
      readonly config: AvatarConfig;
      readonly equipped: AvatarConfig;
    };

export type GarageAction =
  | { readonly kind: "selectSlot"; readonly slot: AvatarSlot }
  | { readonly kind: "selectItem"; readonly slot: AvatarSlot; readonly item: ItemDef }
  | { readonly kind: "selectColor"; readonly index: number; readonly color: string }
  | { readonly kind: "previewUnavailable" }
  | { readonly kind: "loadoutConfirmed"; readonly loadout: AvatarConfig }
  | { readonly kind: "discardPreview" };

type SlotAction = Extract<GarageAction, { kind: "selectSlot" }>;

type ItemAction = Extract<GarageAction, { kind: "selectItem" }>;

type ColorAction = Extract<GarageAction, { kind: "selectColor" }>;

interface SelectionFields {
  readonly slot: AvatarSlot;
  readonly item: ItemDef;
  readonly colors: readonly AvatarColor[];
}

export function createInitialGarageState(
  slot: AvatarSlot = "jersey",
  equipped: Readonly<AvatarConfig> = DEFAULT_AVATAR_CONFIG,
): GarageState {
  const item = avatarItemForSlot(equipped, slot);

  const selection = GaragePreviewSelectionSchema.parse({
    kind: "preview",
    slot,
    item,
    colors: previewColors(item, equipped),
  });

  return { kind: "preview", selection, config: equipped, equipped };
}

/** Back to the equipment: after a confirmed save, a server reread or „Vorschau verwerfen“. */
function resetTo(state: Readonly<GarageState>, equipped: Readonly<AvatarConfig>): GarageState {
  const fresh = createInitialGarageState(state.selection.slot, equipped);

  return state.kind === "unavailable3d" ? previewUnavailable(fresh) : fresh;
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
    case "loadoutConfirmed":
      return resetTo(state, action.loadout);
    case "discardPreview":
      return resetTo(state, state.equipped);
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
    colors: previewColors(item, state.config),
  });
}

function selectItem(state: Readonly<GarageState>, action: Readonly<ItemAction>): GarageState {
  if (action.slot !== state.selection.slot || action.item.slot !== action.slot) return state;

  return updateSelection(state, {
    slot: action.slot,
    item: action.item,
    colors: previewColors(action.item, state.equipped),
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

  return { kind: "unavailable3d", selection, config: state.config, equipped: state.equipped };
}

function selectionFields(state: Readonly<GarageState>): SelectionFields {
  return {
    slot: state.selection.slot,
    item: state.selection.item,
    colors: state.selection.colors,
  };
}

/** Colors a config gives the slot; empty for slots without colors. */
function slotColors(config: Readonly<AvatarConfig>, slot: AvatarSlot): readonly AvatarColor[] {
  switch (slot) {
    case "skin":
      return [config.rider.skinTone];
    case "jersey":
      return config.rider.jerseyColors;
    case "helmet":
      return [config.rider.helmetColor];
    case "frame":
      return [config.bike.frameColor];
    case "shoes":
    case "glasses":
    case "wheels":
      return [];
    default: {
      const exhaustive: never = slot;
      throw new Error(`Unsupported avatar slot: ${String(exhaustive)}`);
    }
  }
}

/** An item worn in `config` keeps its colors; any other item starts with its palette defaults. */
function previewColors(
  item: Readonly<ItemDef>,
  config: Readonly<AvatarConfig>,
): readonly AvatarColor[] {
  if (item.slot === "skin") return [config.rider.skinTone];

  return avatarItemIdForSlot(config, item.slot) === item.id
    ? slotColors(config, item.slot).slice(0, item.colorable)
    : defaultAvatarColors(item);
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

    return { kind: "unavailable3d", selection, config, equipped: state.equipped };
  }

  return { kind: "preview", selection: preview, config, equipped: state.equipped };
}
