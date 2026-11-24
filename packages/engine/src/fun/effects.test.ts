import { expect, it } from "vitest";

import { DEFAULT_RIDER_PARAMS } from "../physics/params.js";
import { effectiveRiderParams, effectWindMps } from "./effects.js";

const base = DEFAULT_RIDER_PARAMS;

it("returns the base params by reference without an active item", () => {
  expect(effectiveRiderParams(base, undefined, 5)).toBe(base);
});

it("aeroBoost scales only cdaM2 by 0.85", () => {
  expect(effectiveRiderParams(base, "aeroBoost", 0)).toEqual({
    ...base,
    cdaM2: base.cdaM2 * 0.85,
  });
});

it("featherweight scales rider and bike mass by 0.9 on flat and uphill only", () => {
  const lighter = { ...base, massKg: base.massKg * 0.9, bikeMassKg: base.bikeMassKg * 0.9 };

  expect(effectiveRiderParams(base, "featherweight", 0)).toEqual(lighter);
  expect(effectiveRiderParams(base, "featherweight", 8)).toEqual(lighter);
  expect(effectiveRiderParams(base, "featherweight", -0.1)).toBe(base);
});

it("tailwind changes no rider params and yields -3 m/s wind", () => {
  expect(effectiveRiderParams(base, "tailwind", 3)).toBe(base);
  expect(effectWindMps("tailwind")).toBe(-3);
  expect(effectWindMps("aeroBoost")).toBe(0);
  expect(effectWindMps()).toBe(0);
});
