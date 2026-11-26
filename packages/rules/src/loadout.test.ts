import { expect, it } from "vitest";

import type { AvatarConfig } from "@voltonaut/shared";

import {
  AVATAR_SLOTS,
  DEFAULT_AVATAR_CONFIG,
  avatarColorOptions,
  decideLoadout,
  defaultAvatarColors,
  defaultInventoryItemIds,
  isAvatarColorOption,
  avatarItemsForSlot,
} from "./index.js";

const owned = defaultInventoryItemIds();

function jersey(id: string) {
  const item = avatarItemsForSlot("jersey").find((candidate) => candidate.id === id);

  if (item === undefined) throw new Error(`Missing catalog item ${id}`);

  return item;
}

function withRider(rider: Partial<AvatarConfig["rider"]>): AvatarConfig {
  return { ...DEFAULT_AVATAR_CONFIG, rider: { ...DEFAULT_AVATAR_CONFIG.rider, ...rider } };
}

function withBike(bike: Partial<AvatarConfig["bike"]>): AvatarConfig {
  return { ...DEFAULT_AVATAR_CONFIG, bike: { ...DEFAULT_AVATAR_CONFIG.bike, ...bike } };
}

it("rejects missing input at the public boundary", () => {
  expect(decideLoadout).toThrow("Required");
});

it("accepts the default loadout with the default items", () => {
  expect(decideLoadout({ loadout: DEFAULT_AVATAR_CONFIG, ownedItemIds: owned })).toEqual({
    kind: "valid",
  });
});

it("rejects every unowned item and names it", () => {
  const loadout = withBike({ frameId: "frame.aero", wheelsId: "wheels.carbon-deep" });

  expect(decideLoadout({ loadout, ownedItemIds: owned })).toEqual({
    kind: "not_owned",
    itemIds: ["frame.aero", "wheels.carbon-deep"],
  });
  expect(
    decideLoadout({ loadout, ownedItemIds: [...owned, "frame.aero", "wheels.carbon-deep"] }),
  ).toEqual({ kind: "valid" });
  expect(decideLoadout({ loadout: DEFAULT_AVATAR_CONFIG, ownedItemIds: [] })).toEqual({
    kind: "not_owned",
    itemIds: [
      "skin.03",
      "jersey.classic",
      "helmet.standard",
      "shoes.white",
      "glasses.none",
      "frame.race",
      "wheels.alloy",
    ],
  });
});

it("rejects unknown items and items of another slot", () => {
  expect(
    decideLoadout({ loadout: withRider({ helmetId: "jersey.classic" }), ownedItemIds: owned }),
  ).toEqual({ kind: "invalid_items", slots: ["helmet"] });
  expect(
    decideLoadout({ loadout: withBike({ wheelsId: "wheels.unknown" }), ownedItemIds: owned }),
  ).toEqual({ kind: "invalid_items", slots: ["wheels"] });
});

it("rejects colors outside the slot palette and any bar tape color", () => {
  expect(
    decideLoadout({ loadout: withRider({ helmetColor: "#123456" }), ownedItemIds: owned }),
  ).toEqual({ kind: "invalid_colors", slots: ["helmet"] });
  expect(
    decideLoadout({
      loadout: withRider({ jerseyColors: ["#ec6b48", "#d3dadb"], skinTone: "#000000" }),
      ownedItemIds: owned,
    }),
  ).toEqual({ kind: "invalid_colors", slots: ["skin", "jersey"] });
  expect(
    decideLoadout({ loadout: withBike({ frameColor: "#F0A83B" }), ownedItemIds: owned }),
  ).toEqual({ kind: "invalid_colors", slots: ["frame"] });
  expect(
    decideLoadout({ loadout: withBike({ barTapeColor: "#f0a83b" }), ownedItemIds: owned }),
  ).toEqual({ kind: "invalid_colors", slots: ["frame"] });
});

it("offers exactly the catalog palettes per slot and default colors per item", () => {
  expect(AVATAR_SLOTS.map((slot) => avatarColorOptions(slot))).toEqual([
    ["#f1c7a5", "#e7cbb7", "#c98d68", "#98664f", "#b77b4f", "#654638"],
    ["#ec6b48", "#f5ebca", "#45c4b0", "#7b61ff", "#ffd60a", "#202830"],
    ["#f5ebca", "#45c4b0", "#ec6b48", "#202830"],
    ["#f5ebca", "#202830", "#ec6b48"],
    ["#202830", "#7b61ff", "#45c4b0"],
    ["#f0a83b", "#45c4b0", "#ec6b48", "#7b61ff", "#202830"],
    ["#d3dadb", "#58666b", "#263238"],
  ]);

  expect(defaultAvatarColors(jersey("jersey.stripe"))).toEqual(["#ec6b48", "#f5ebca"]);
  expect(isAvatarColorOption("wheels", "#d3dadb")).toBe(true);
  expect(isAvatarColorOption("wheels", "#ec6b48")).toBe(false);
});
