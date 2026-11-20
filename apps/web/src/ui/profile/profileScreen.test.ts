import { describe, expect, it } from "vitest";

import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";

import type { ProfileFormFields } from "./profileScreen.js";
import { fillProfileForm, parseProfileForm, readProfileForm } from "./profileScreen.js";
import type { ProfileFormInputs } from "./profileScreen.js";

function fakeInputs(overrides: Partial<ProfileFormFields> = {}): ProfileFormInputs {
  const fields: ProfileFormFields = {
    displayName: "Rider",
    massKg: "75",
    heightCm: "185",
    bikeMassKg: "8",
    chainringTeeth: "42",
    cogTeeth: "14",
    wheelCircM: "2.105",
    units: "metric",
    ...overrides,
  };

  return {
    displayName: { value: fields.displayName },
    massKg: { value: fields.massKg },
    heightCm: { value: fields.heightCm },
    bikeMassKg: { value: fields.bikeMassKg },
    chainringTeeth: { value: fields.chainringTeeth },
    cogTeeth: { value: fields.cogTeeth },
    wheelCircM: { value: fields.wheelCircM },
    units: { value: fields.units },
  };
}

describe("readProfileForm / fillProfileForm", () => {
  it("round-trips a profile through the form inputs", () => {
    const inputs = fakeInputs();

    fillProfileForm(inputs, DEFAULT_RIDER_PROFILE);

    expect(readProfileForm(inputs)).toEqual({
      displayName: "Rider",
      massKg: "75",
      heightCm: "185",
      bikeMassKg: "8",
      chainringTeeth: "42",
      cogTeeth: "14",
      wheelCircM: "2.105",
      units: "metric",
    });
  });
});

describe("parseProfileForm", () => {
  it("accepts the default profile", () => {
    const result = parseProfileForm(readProfileForm(fakeInputs()));

    expect(result).toEqual({ ok: true, profile: DEFAULT_RIDER_PROFILE });
  });

  it("rejects a mass outside 30-200 kg (docs/03 section 2a)", () => {
    expect(parseProfileForm(readProfileForm(fakeInputs({ massKg: "250" }))).ok).toBe(false);
    expect(parseProfileForm(readProfileForm(fakeInputs({ massKg: "10" }))).ok).toBe(false);
  });

  it("rejects heights outside 120-220 cm", () => {
    expect(parseProfileForm(readProfileForm(fakeInputs({ heightCm: "90" }))).ok).toBe(false);
  });

  it("rejects chainrings outside 28-60 teeth and wheels outside 1.9-2.4 m", () => {
    expect(parseProfileForm(readProfileForm(fakeInputs({ chainringTeeth: "20" }))).ok).toBe(false);
    expect(parseProfileForm(readProfileForm(fakeInputs({ wheelCircM: "2.7" }))).ok).toBe(false);
  });

  it("rejects non-numeric and empty fields", () => {
    expect(parseProfileForm(readProfileForm(fakeInputs({ massKg: "abc" }))).ok).toBe(false);
    expect(parseProfileForm(readProfileForm(fakeInputs({ displayName: "" }))).ok).toBe(false);
    expect(parseProfileForm(readProfileForm(fakeInputs({ massKg: "" }))).ok).toBe(false);
  });

  it("rejects an unknown units value", () => {
    expect(parseProfileForm(readProfileForm(fakeInputs({ units: "leagues" }))).ok).toBe(false);
  });
});
