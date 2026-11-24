import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AvatarConfigSchema,
  AvatarSlotSchema,
  GarageSelectionSchema,
  ItemDefSchema,
  UnlockRuleSchema,
  type AvatarConfig,
  type GarageSelection,
  type ItemDef,
  type NonShopItemDef,
  type ShopItemDef,
} from "./avatarCatalog.js";

const item = {
  id: "jersey.classic",
  slot: "jersey",
  name: "Voltonaut Classic",
  assetRef: "procedural://rider/jersey/classic",
  colorable: 2,
  unlock: { kind: "default" },
  rarity: "common",
} satisfies ItemDef;

const config = {
  rider: {
    skinTone: "#c98d68",
    jerseyId: "jersey.classic",
    jerseyColors: ["#ec6b48", "#f5ebca"],
    helmetId: "helmet.standard",
    helmetColor: "#f5ebca",
    shoesId: "shoes.white",
    glassesId: "glasses.none",
  },
  bike: {
    frameId: "frame.race",
    frameColor: "#f0a83b",
    wheelsId: "wheels.alloy",
  },
} satisfies AvatarConfig;

const selection = {
  kind: "preview",
  slot: "jersey",
  item,
  colors: ["#112233", "#445566"],
} satisfies GarageSelection;

describe("avatar catalog contracts", () => {
  it("accepts every canonical slot and unlock rule", () => {
    expect(AvatarSlotSchema.options).toEqual([
      "skin",
      "jersey",
      "helmet",
      "shoes",
      "glasses",
      "frame",
      "wheels",
    ]);

    const rules = [
      { kind: "default" },
      { kind: "level", level: 5 },
      { kind: "badge", badgeId: "kom-hunter" },
      { kind: "distanceTotal", km: 100 },
      { kind: "shop", priceVolts: 6000, minLevel: 5 },
    ];

    for (const rule of rules) expect(UnlockRuleSchema.parse(rule)).toEqual(rule);
    expectTypeOf<ItemDef["slot"]>().toEqualTypeOf<
      "skin" | "jersey" | "helmet" | "shoes" | "glasses" | "frame" | "wheels"
    >();
  });

  it("parses immutable-shaped config and selection data without adding account authority", () => {
    expect(ItemDefSchema.parse(item)).toEqual(item);
    expect(AvatarConfigSchema.parse(config)).toEqual(config);
    expect(GarageSelectionSchema.parse(selection)).toEqual(selection);
    expect(
      GarageSelectionSchema.parse({
        ...selection,
        kind: "unavailable3d",
        reason: "webgl-unavailable",
      }),
    ).toMatchObject({ kind: "unavailable3d", reason: "webgl-unavailable" });
    expectTypeOf<AvatarConfig["rider"]["jerseyColors"]>().toEqualTypeOf<
      readonly [string, string]
    >();
  });
});

describe("item price types", () => {
  it("makes priced items shop-only at the type level", () => {
    expectTypeOf<ItemDef>().toEqualTypeOf<ShopItemDef | NonShopItemDef>();
    expectTypeOf<Extract<ItemDef, { priceVolts: number }>>().toEqualTypeOf<ShopItemDef>();
    expectTypeOf<
      Extract<ItemDef, { unlock: { kind: "shop" } }>["priceVolts"]
    >().toEqualTypeOf<number>();
    expectTypeOf<Extract<ItemDef, { priceVolts?: never }>>().toEqualTypeOf<NonShopItemDef>();
    expectTypeOf<
      Extract<ItemDef, { priceVolts?: never }>["priceVolts"]
    >().toEqualTypeOf<undefined>();
  });
});

describe("avatar item validation", () => {
  it.each([
    { ...item, slot: "bike" },
    { ...item, id: "" },
    { ...item, assetRef: "" },
    { ...item, colorable: -1 },
    { ...item, colorable: 4 },
    { ...item, colorable: 1.5 },
    { ...item, rarity: "mythic" },
    { ...item, unlock: { kind: "level", level: 0 } },
    { ...item, unlock: { kind: "distanceTotal", km: 0 } },
    { ...item, unlock: { kind: "shop", priceVolts: -1 } },
    { ...item, priceVolts: 1500 },
    {
      ...item,
      unlock: { kind: "shop", priceVolts: 1500 },
      priceVolts: 6000,
    },
    {
      ...item,
      unlock: { kind: "shop", priceVolts: 1500 },
    },
    { ...item, owned: true },
    { ...item, voltsBalance: 99_999 },
  ])("rejects malformed item data %#", (candidate: Readonly<object>) => {
    expect(ItemDefSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("avatar price and config validation", () => {
  it("rejects non-integer, unsafe and non-finite prices", () => {
    for (const priceVolts of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      expect(
        ItemDefSchema.safeParse({
          ...item,
          unlock: { kind: "shop", priceVolts },
          priceVolts,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects malformed colors, missing slot IDs and extra config fields", () => {
    const candidates = [
      { ...config, rider: { ...config.rider, skinTone: "brown" } },
      { ...config, rider: { ...config.rider, jerseyColors: ["#112233"] } },
      { ...config, rider: { ...config.rider, jerseyId: "" } },
      { ...config, bike: { ...config.bike, frameColor: "#12345g" } },
      { ...config, voltsBalance: 1000 },
      { ...config, bike: { ...config.bike, owned: true } },
    ];

    for (const candidate of candidates) {
      expect(AvatarConfigSchema.safeParse(candidate).success).toBe(false);
    }
  });
});

describe("garage selection contracts", () => {
  it("keeps slot, item and color count in one valid state", () => {
    expect(GarageSelectionSchema.safeParse(selection).success).toBe(true);
    expect(GarageSelectionSchema.safeParse({ ...selection, slot: "frame" }).success).toBe(false);
    expect(GarageSelectionSchema.safeParse({ ...selection, colors: ["#112233"] }).success).toBe(
      false,
    );
    expect(
      GarageSelectionSchema.safeParse({ ...selection, colors: ["#112233", "#445566", "#778899"] })
        .success,
    ).toBe(false);
    expect(
      GarageSelectionSchema.safeParse({ ...selection, colors: ["brown", "#445566"] }).success,
    ).toBe(false);
  });

  it("rejects missing unavailable reasons and unknown UI fields", () => {
    expect(GarageSelectionSchema.safeParse({ ...selection, kind: "unavailable3d" }).success).toBe(
      false,
    );
    expect(GarageSelectionSchema.safeParse({ ...selection, owned: true }).success).toBe(false);
    expect(GarageSelectionSchema.safeParse({ ...selection, voltsBalance: 1000 }).success).toBe(
      false,
    );
  });
});
