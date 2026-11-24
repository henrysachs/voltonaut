import { describe, expect, it } from "vitest";

import {
  AvatarConfigSchema,
  GarageSelectionSchema,
  ItemDefSchema,
  type AvatarSlot,
  type ItemDef,
} from "@voltonaut/shared";

import {
  AVATAR_SLOTS,
  DEFAULT_AVATAR_CONFIG,
  START_AVATAR_CATALOG,
  avatarItemForSlot,
  avatarItemIdForSlot,
  avatarItemsForSlot,
  previewAvatarConfig,
} from "./avatarCatalog.js";

function catalogItem(id: string): ItemDef {
  const item = START_AVATAR_CATALOG.find((candidate) => candidate.id === id);

  if (item === undefined) throw new Error(`Missing test catalog item: ${id}`);

  return item;
}

function preview(item: ItemDef, colors: readonly string[] = []) {
  return GarageSelectionSchema.parse({
    kind: "preview",
    slot: item.slot,
    item,
    colors,
  });
}

describe("start avatar catalog", () => {
  it("covers every documented slot and start item count with strict shared data", () => {
    const counts = new Map<AvatarSlot, number>();

    for (const slot of AVATAR_SLOTS) counts.set(slot, avatarItemsForSlot(slot).length);

    expect(Object.fromEntries(counts)).toEqual({
      skin: 6,
      jersey: 6,
      helmet: 3,
      shoes: 2,
      glasses: 3,
      frame: 3,
      wheels: 4,
    });
    expect(Object.isFrozen(START_AVATAR_CATALOG)).toBe(true);
    expect(new Set(START_AVATAR_CATALOG.map((item) => item.id)).size).toBe(
      START_AVATAR_CATALOG.length,
    );

    for (const item of START_AVATAR_CATALOG) {
      expect(ItemDefSchema.safeParse(item).success).toBe(true);
      expect(item.assetRef.startsWith("procedural://")).toBe(true);
    }
  });

  it("maps every default config slot to an item in the same slot", () => {
    expect(AvatarConfigSchema.parse(DEFAULT_AVATAR_CONFIG)).toEqual(DEFAULT_AVATAR_CONFIG);

    for (const slot of AVATAR_SLOTS) {
      const item = avatarItemForSlot(DEFAULT_AVATAR_CONFIG, slot);
      expect(item.slot).toBe(slot);
      expect(avatarItemIdForSlot(DEFAULT_AVATAR_CONFIG, slot)).toBe(item.id);
    }
  });

  it("reports a missing configured item instead of inventing ownership or a fallback", () => {
    const config = AvatarConfigSchema.parse({
      ...DEFAULT_AVATAR_CONFIG,
      rider: { ...DEFAULT_AVATAR_CONFIG.rider, jerseyId: "jersey.missing" },
    });

    expect(() => avatarItemForSlot(config, "jersey")).toThrow("Missing avatar item");
  });
});

describe("avatar preview config", () => {
  it("updates jersey ID and both colors without mutating the input config", () => {
    const item = catalogItem("jersey.aurora");

    const result = previewAvatarConfig(
      DEFAULT_AVATAR_CONFIG,
      preview(item, ["#112233", "#445566"]),
    );

    expect(result.rider.jerseyId).toBe(item.id);
    expect(result.rider.jerseyColors).toEqual(["#112233", "#445566"]);
    expect(DEFAULT_AVATAR_CONFIG.rider.jerseyId).toBe("jersey.classic");
    expect(DEFAULT_AVATAR_CONFIG.rider.jerseyColors).toEqual(["#ec6b48", "#f5ebca"]);
  });

  it("updates helmet, frame and their selected colors", () => {
    const helmet = catalogItem("helmet.halo");
    const frame = catalogItem("frame.gravel");
    const withHelmet = previewAvatarConfig(DEFAULT_AVATAR_CONFIG, preview(helmet, ["#123456"]));
    const withFrame = previewAvatarConfig(withHelmet, preview(frame, ["#654321"]));

    expect(withFrame.rider.helmetId).toBe(helmet.id);
    expect(withFrame.rider.helmetColor).toBe("#123456");
    expect(withFrame.bike.frameId).toBe(frame.id);
    expect(withFrame.bike.frameColor).toBe("#654321");
  });

  it("updates the skin tone and IDs for shoes, glasses and wheels", () => {
    const expected: readonly (readonly [string, "shoesId" | "glassesId"])[] = [
      ["shoes.carbon", "shoesId"],
      ["glasses.clear", "glassesId"],
    ];

    let config = previewAvatarConfig(DEFAULT_AVATAR_CONFIG, preview(catalogItem("skin.04")));
    expect(config.rider.skinTone).toBe("#98664f");
    expect(avatarItemIdForSlot(config, "skin")).toBe("skin.04");

    for (const [id, field] of expected) {
      config = previewAvatarConfig(config, preview(catalogItem(id)));
      expect(config.rider[field]).toBe(id);
    }

    config = previewAvatarConfig(config, preview(catalogItem("wheels.carbon-deep")));
    expect(config.bike.wheelsId).toBe("wheels.carbon-deep");
  });
});

describe("avatar preview boundaries", () => {
  it("keeps the current skin tone for an unknown procedural skin item", () => {
    const item = ItemDefSchema.parse({
      id: "skin.custom",
      slot: "skin",
      name: "Custom skin",
      assetRef: "procedural://skin/custom",
      colorable: 0,
      unlock: { kind: "default" },
      rarity: "common",
    });

    expect(previewAvatarConfig(DEFAULT_AVATAR_CONFIG, preview(item)).rider.skinTone).toBe(
      DEFAULT_AVATAR_CONFIG.rider.skinTone,
    );
  });

  it("uses the default skin item for a custom skin tone", () => {
    const config = AvatarConfigSchema.parse({
      ...DEFAULT_AVATAR_CONFIG,
      rider: { ...DEFAULT_AVATAR_CONFIG.rider, skinTone: "#112233" },
    });

    expect(avatarItemIdForSlot(config, "skin")).toBe("skin.03");
  });

  it("revalidates config and selection at the public preview boundary", () => {
    const item = catalogItem("jersey.classic");
    const invalidSelection = { ...preview(item, ["#112233", "#445566"]), colors: ["#112233"] };
    const invalidConfig = { ...DEFAULT_AVATAR_CONFIG, voltsBalance: 1000 };

    expect(() => previewAvatarConfig(DEFAULT_AVATAR_CONFIG, invalidSelection)).toThrow(
      "Color count must match the item colorable count",
    );
    expect(() => previewAvatarConfig(invalidConfig, preview(item, ["#112233", "#445566"]))).toThrow(
      "Unrecognized key",
    );
  });
});
