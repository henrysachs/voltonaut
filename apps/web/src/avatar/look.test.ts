import { describe, expect, it } from "vitest";

import { DEFAULT_AVATAR_CONFIG } from "@voltonaut/rules";
import { AvatarConfigSchema } from "@voltonaut/shared";

import { avatarLook } from "./look.js";

describe("procedural avatar look", () => {
  it("keeps the default race bike and no glasses", () => {
    expect(avatarLook(DEFAULT_AVATAR_CONFIG)).toEqual({
      frameRadiusM: 0.025,
      rimColor: 0xd3dadb,
      rimRoughness: 0.25,
      shoeColor: 0xf5ebca,
      glassesVisible: false,
      jerseyAccentRadiusM: 0.152,
      jerseyAccentRoughness: 0.85,
    });
  });

  it("varies frame thickness and visible accessories", () => {
    const aero = AvatarConfigSchema.parse({
      ...DEFAULT_AVATAR_CONFIG,
      bike: { ...DEFAULT_AVATAR_CONFIG.bike, frameId: "frame.aero" },
      rider: {
        ...DEFAULT_AVATAR_CONFIG.rider,
        shoesId: "shoes.carbon",
        glassesId: "glasses.sport",
      },
    });

    const gravel = AvatarConfigSchema.parse({
      ...DEFAULT_AVATAR_CONFIG,
      bike: { ...DEFAULT_AVATAR_CONFIG.bike, frameId: "frame.gravel" },
    });

    expect(avatarLook(aero)).toMatchObject({
      frameRadiusM: 0.032,
      shoeColor: 0x18272e,
      glassesVisible: true,
    });
    expect(avatarLook(gravel).frameRadiusM).toBe(0.023);
  });
});

describe("procedural wheel look", () => {
  it("varies rim color and roughness for every wheel item", () => {
    const expected = [
      ["wheels.carbon-flat", 0x58666b],
      ["wheels.carbon-deep", 0x263238],
      ["wheels.disc", 0x7d898d],
    ];

    for (const [wheelsId, rimColor] of expected) {
      const config = AvatarConfigSchema.parse({
        ...DEFAULT_AVATAR_CONFIG,
        bike: { ...DEFAULT_AVATAR_CONFIG.bike, wheelsId },
      });

      expect(avatarLook(config)).toMatchObject({ rimColor, rimRoughness: 0.5 });
    }
  });
});
