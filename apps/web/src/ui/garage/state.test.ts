import { describe, expect, it } from "vitest";

import { avatarItemsForSlot } from "@voltonaut/rules";
import type { AvatarSlot, ItemDef } from "@voltonaut/shared";

import { defaultPreviewColors } from "./palettes.js";
import { createInitialGarageState, garageReducer } from "./state.js";

function catalogItem(id: string): ItemDef {
  const item = avatarItemsForSlot("jersey").find((candidate) => candidate.id === id);

  if (item === undefined) throw new Error(`Missing test item: ${id}`);

  return item;
}

describe("initial garage state", () => {
  it("starts with the configured default item and only preview data", () => {
    const state = createInitialGarageState();

    expect(state.kind).toBe("preview");
    expect(state.selection.slot).toBe("jersey");
    expect(state.selection.item.id).toBe("jersey.classic");
    expect(state.selection.colors).toEqual(["#ec6b48", "#f5ebca"]);
    expect(state.config).toEqual({
      rider: {
        skinTone: "#c98d68",
        jerseyId: "jersey.classic",
        jerseyColors: ["#ec6b48", "#f5ebca"],
        helmetId: "helmet.standard",
        helmetColor: "#f5ebca",
        shoesId: "shoes.white",
        glassesId: "glasses.none",
      },
      bike: { frameId: "frame.race", frameColor: "#f0a83b", wheelsId: "wheels.alloy" },
    });
    expect(state).not.toHaveProperty("owned");
    expect(state).not.toHaveProperty("voltsBalance");
  });

  it("provides exactly the declared color count for every catalog item", () => {
    const slots: readonly AvatarSlot[] = [
      "skin",
      "jersey",
      "helmet",
      "shoes",
      "glasses",
      "frame",
      "wheels",
    ];

    for (const slot of slots) {
      for (const item of avatarItemsForSlot(slot)) {
        expect(defaultPreviewColors(item)).toHaveLength(item.colorable);
      }
    }
  });
});

describe("garage selection", () => {
  it("selects the configured item for a new slot", () => {
    const state = garageReducer(createInitialGarageState(), { kind: "selectSlot", slot: "frame" });

    expect(state.selection.slot).toBe("frame");
    expect(state.selection.item.id).toBe("frame.race");
    expect(state.config.bike.frameId).toBe("frame.race");
  });

  it("previews a shop item and its price without granting it", () => {
    const initial = createInitialGarageState();

    const state = garageReducer(initial, {
      kind: "selectItem",
      slot: "jersey",
      item: catalogItem("jersey.stripe"),
    });

    expect(state.selection.item.priceVolts).toBe(1500);
    expect(state.config.rider.jerseyId).toBe("jersey.stripe");
    expect(state).not.toHaveProperty("owned");
    expect(state).not.toHaveProperty("purchased");
    expect(initial.config.rider.jerseyId).toBe("jersey.classic");
  });

  it("ignores an item from another slot", () => {
    const initial = garageReducer(createInitialGarageState(), {
      kind: "selectSlot",
      slot: "frame",
    });

    expect(
      garageReducer(initial, {
        kind: "selectItem",
        slot: "frame",
        item: catalogItem("jersey.classic"),
      }),
    ).toBe(initial);
  });
});

describe("garage colors and unavailable preview", () => {
  it("changes one preview color and keeps the previous state immutable", () => {
    const initial = createInitialGarageState();
    const state = garageReducer(initial, { kind: "selectColor", index: 1, color: "#112233" });

    expect(state.selection.colors).toEqual(["#ec6b48", "#112233"]);
    expect(state.config.rider.jerseyColors).toEqual(["#ec6b48", "#112233"]);
    expect(initial.selection.colors).toEqual(["#ec6b48", "#f5ebca"]);
    expect(initial.config.rider.jerseyColors).toEqual(["#ec6b48", "#f5ebca"]);
  });

  it("ignores invalid color indexes and malformed colors", () => {
    const initial = createInitialGarageState();

    expect(garageReducer(initial, { kind: "selectColor", index: 2, color: "#112233" })).toBe(
      initial,
    );
    expect(garageReducer(initial, { kind: "selectColor", index: -1, color: "#112233" })).toBe(
      initial,
    );
    expect(garageReducer(initial, { kind: "selectColor", index: 0, color: "red" })).toBe(initial);
  });

  it("keeps browsing and color changes available when 3D is unavailable", () => {
    const initial = createInitialGarageState();
    const unavailable = garageReducer(initial, { kind: "previewUnavailable" });

    expect(unavailable).toMatchObject({
      kind: "unavailable3d",
      selection: {
        kind: "unavailable3d",
        reason: "webgl-unavailable",
        item: { id: "jersey.classic" },
      },
    });
    expect(unavailable.config).toEqual(initial.config);

    const changed = garageReducer(unavailable, { kind: "selectColor", index: 0, color: "#123456" });
    expect(changed).toMatchObject({
      kind: "unavailable3d",
      selection: { colors: ["#123456", "#f5ebca"] },
      config: { rider: { jerseyColors: ["#123456", "#f5ebca"] } },
    });
    expect(garageReducer(changed, { kind: "previewUnavailable" })).toBe(changed);
  });
});
