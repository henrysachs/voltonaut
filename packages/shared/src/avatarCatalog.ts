import { z } from "zod";

const itemId = z.string().trim().min(1).max(120);
const assetRef = z.string().trim().min(1).max(200);
const badgeId = z.string().trim().min(1).max(120);

export const AvatarColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export type AvatarColor = z.infer<typeof AvatarColorSchema>;

export const AvatarSlotSchema = z.enum([
  "skin",
  "jersey",
  "helmet",
  "shoes",
  "glasses",
  "frame",
  "wheels",
]);

export type AvatarSlot = z.infer<typeof AvatarSlotSchema>;

export const AvatarRaritySchema = z.enum(["common", "rare", "epic", "legendary"]);

export type AvatarRarity = z.infer<typeof AvatarRaritySchema>;

const priceVolts = z.number().finite().int().min(1).max(Number.MAX_SAFE_INTEGER);
const minLevel = z.number().finite().int().min(1).max(50);

export const UnlockRuleSchema = z.union([
  z
    .object({ kind: z.literal("default") })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("level"), level: minLevel })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("badge"), badgeId })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("distanceTotal"), km: z.number().finite().positive().max(1_000_000) })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("shop"), priceVolts, minLevel: minLevel.optional() })
    .strict()
    .readonly(),
]);

export type UnlockRule = z.infer<typeof UnlockRuleSchema>;

const itemDefinition = z
  .object({
    id: itemId,
    slot: AvatarSlotSchema,
    name: z.string().trim().min(1).max(120),
    assetRef,
    colorable: z.number().finite().int().min(0).max(3),
    unlock: UnlockRuleSchema,
    rarity: AvatarRaritySchema,
    priceVolts: priceVolts.optional(),
  })
  .strict()
  .readonly();

type ItemDefData = z.infer<typeof itemDefinition>;

type ItemDefFields = Omit<ItemDefData, "unlock" | "priceVolts">;

export type ShopUnlockRule = Extract<UnlockRule, { kind: "shop" }>;

export type NonShopUnlockRule = Exclude<UnlockRule, { kind: "shop" }>;

export type ShopItemDef = Readonly<ItemDefFields> & {
  readonly unlock: ShopUnlockRule;
  readonly priceVolts: number;
};

export type NonShopItemDef = Readonly<ItemDefFields> & {
  readonly unlock: NonShopUnlockRule;
  readonly priceVolts?: never;
};

export type ItemDef = ShopItemDef | NonShopItemDef;

function validateItem(
  item: Readonly<ItemDefData>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod owns this callback context; validation only calls addIssue.
  context: Readonly<z.RefinementCtx>,
): void {
  if (item.unlock.kind !== "shop" && item.priceVolts !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Only shop items can have a price",
      path: ["priceVolts"],
    });
  }

  if (item.unlock.kind === "shop") {
    if (item.priceVolts === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Shop items require a price",
        path: ["priceVolts"],
      });
    } else if (item.priceVolts !== item.unlock.priceVolts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Item and unlock rule prices must match",
        path: ["priceVolts"],
      });
    }
  }
}

function toItemDef(item: Readonly<ItemDefData>): ItemDef {
  const fields: ItemDefFields = {
    id: item.id,
    slot: item.slot,
    name: item.name,
    assetRef: item.assetRef,
    colorable: item.colorable,
    rarity: item.rarity,
  };

  if (item.unlock.kind === "shop") {
    return {
      ...fields,
      unlock: item.unlock,
      priceVolts: item.priceVolts ?? item.unlock.priceVolts,
    };
  }

  return { ...fields, unlock: item.unlock };
}

export const ItemDefSchema = itemDefinition.superRefine(validateItem).transform(toItemDef);

export const AvatarJerseyColorsSchema = z.tuple([AvatarColorSchema, AvatarColorSchema]).readonly();

export const AvatarConfigSchema = z
  .object({
    rider: z
      .object({
        skinTone: AvatarColorSchema,
        jerseyId: itemId,
        jerseyColors: AvatarJerseyColorsSchema,
        helmetId: itemId,
        helmetColor: AvatarColorSchema,
        shoesId: itemId,
        glassesId: itemId,
      })
      .strict()
      .readonly(),
    bike: z
      .object({
        frameId: itemId,
        frameColor: AvatarColorSchema,
        wheelsId: itemId,
        barTapeColor: AvatarColorSchema.optional(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();

export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;

const selectionFields = {
  slot: AvatarSlotSchema,
  item: ItemDefSchema,
  colors: z.array(AvatarColorSchema).max(3).readonly(),
};

function validateSelection(
  selection: Readonly<{
    slot: AvatarSlot;
    item: ItemDef;
    colors: readonly string[];
  }>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod owns this callback context; validation only calls addIssue.
  context: Readonly<z.RefinementCtx>,
): void {
  if (selection.slot !== selection.item.slot) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Selected slot must match the item slot",
      path: ["slot"],
    });
  }

  if (selection.colors.length !== selection.item.colorable) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Color count must match the item colorable count",
      path: ["colors"],
    });
  }
}

export const GaragePreviewSelectionSchema = z
  .object({ kind: z.literal("preview"), ...selectionFields })
  .strict()
  .readonly()
  .superRefine(validateSelection);

export const GarageUnavailable3dSelectionSchema = z
  .object({
    kind: z.literal("unavailable3d"),
    reason: z.literal("webgl-unavailable"),
    ...selectionFields,
  })
  .strict()
  .readonly()
  .superRefine(validateSelection);

export const GarageSelectionSchema = z.union([
  GaragePreviewSelectionSchema,
  GarageUnavailable3dSelectionSchema,
]);

export type GarageSelection = z.infer<typeof GarageSelectionSchema>;

export type GaragePreviewSelection = Extract<GarageSelection, { kind: "preview" }>;
