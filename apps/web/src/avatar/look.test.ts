import { describe, expect, it } from "vitest";

import { DEFAULT_AVATAR_CONFIG, START_AVATAR_CATALOG } from "@voltonaut/rules";
import { AvatarConfigSchema, type ItemDef } from "@voltonaut/shared";

import { FRAME_SPECS, WHEEL_SPECS } from "./bikeSpecs.js";

const FRAME_KEYS = FRAME_SPECS.map((spec) => spec.key);
const WHEEL_KEYS = WHEEL_SPECS.map((spec) => spec.key);

import { avatarLook } from "./look.js";

function withBike(frameId: string, wheelsId: string): ReturnType<typeof AvatarConfigSchema.parse> {
  return AvatarConfigSchema.parse({
    ...DEFAULT_AVATAR_CONFIG,
    bike: { ...DEFAULT_AVATAR_CONFIG.bike, frameId, wheelsId },
  });
}

describe("procedural avatar look", () => {
  it("keeps the default race bike, alloy wheels and no glasses", () => {
    const look = avatarLook(DEFAULT_AVATAR_CONFIG);

    expect(look.frame.key).toBe("race");
    expect(look.wheels.key).toBe("alloy");
    expect(look).toMatchObject({
      shoeColor: 0xf5ebca,
      glassesVisible: false,
      jerseyAccentRadiusM: 0.152,
      jerseyAccentRoughness: 0.85,
    });
  });

  it("varies shoes and glasses", () => {
    const aero = AvatarConfigSchema.parse({
      ...DEFAULT_AVATAR_CONFIG,
      rider: {
        ...DEFAULT_AVATAR_CONFIG.rider,
        shoesId: "shoes.carbon",
        glassesId: "glasses.sport",
      },
    });

    expect(avatarLook(aero)).toMatchObject({ shoeColor: 0x18272e, glassesVisible: true });
  });
});

const FRAME_ITEMS = START_AVATAR_CATALOG.filter((item) => item.slot === "frame");
const WHEEL_ITEMS = START_AVATAR_CATALOG.filter((item) => item.slot === "wheels");

function specKeyOf(assetRef: string): string {
  return assetRef.slice(assetRef.lastIndexOf("/") + 1);
}

describe("frame and wheel items of the shop catalog", () => {
  it.each(FRAME_ITEMS)("resolves $id to its own frame spec", (item) => {
    expect(FRAME_KEYS).toContain(specKeyOf(item.assetRef));
    expect(avatarLook(withBike(item.id, "wheels.alloy")).frame.key).toBe(specKeyOf(item.assetRef));
  });

  it.each(WHEEL_ITEMS)("resolves $id to its own wheel spec", (item) => {
    expect(WHEEL_KEYS).toContain(specKeyOf(item.assetRef));
    expect(avatarLook(withBike("frame.race", item.id)).wheels.key).toBe(specKeyOf(item.assetRef));
  });
});

describe("bike specs for future catalog items", () => {
  it("lets a new catalog item reuse or select a spec without code changes", () => {
    const extra: ItemDef = {
      id: "wheels.team-edition",
      slot: "wheels",
      name: "Team",
      assetRef: "procedural://bike/wheels/carbon-deep",
      colorable: 0,
      unlock: { kind: "default" },
      rarity: "rare",
    };

    const look = avatarLook(withBike("frame.race", "wheels.team-edition"), [
      ...START_AVATAR_CATALOG,
      extra,
    ]);

    expect(look.wheels.key).toBe("carbon-deep");
  });

  it("falls back to the default bike for unknown or non-procedural assets", () => {
    const glb: ItemDef = {
      id: "frame.future",
      slot: "frame",
      name: "Future",
      assetRef: "assets/frame-future.glb",
      colorable: 1,
      unlock: { kind: "default" },
      rarity: "common",
    };

    const look = avatarLook(withBike("frame.future", "wheels.missing"), [glb]);

    expect(look.frame.key).toBe("race");
    expect(look.wheels.key).toBe("alloy");
  });
});
