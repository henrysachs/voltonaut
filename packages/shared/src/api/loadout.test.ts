import { expect, it } from "vitest";

import { ErrorCodeSchema, LoadoutResponseSchema, LoadoutUpdateSchema } from "./index.js";

const loadout = {
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
};

it("accepts a stored or default loadout response", () => {
  expect(LoadoutResponseSchema.parse({ loadout, updatedAt: null }).updatedAt).toBeNull();
  expect(
    LoadoutResponseSchema.parse({ loadout, updatedAt: "2026-11-25T12:00:00.000Z" }).updatedAt,
  ).toBe("2026-11-25T12:00:00.000Z");
});

it("rejects unknown fields, malformed colors and a missing slot", () => {
  expect(LoadoutUpdateSchema.safeParse({ loadout, extra: true }).success).toBe(false);
  expect(
    LoadoutUpdateSchema.safeParse({
      loadout: { ...loadout, rider: { ...loadout.rider, helmetColor: "red" } },
    }).success,
  ).toBe(false);
  expect(
    LoadoutUpdateSchema.safeParse({
      loadout: { ...loadout, bike: { frameId: "frame.race", frameColor: "#f0a83b" } },
    }).success,
  ).toBe(false);
  expect(
    LoadoutUpdateSchema.safeParse({
      loadout: { ...loadout, rider: { ...loadout.rider, capId: "cap.red" } },
    }).success,
  ).toBe(false);
});

it("knows the not_owned error code", () => {
  expect(ErrorCodeSchema.parse("not_owned")).toBe("not_owned");
});
