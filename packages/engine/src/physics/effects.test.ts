import { expect, it } from "vitest";

import { FUN_ITEMS } from "@voltonaut/shared";

import { DEFAULT_RIDER_PARAMS } from "./params.js";
import { advanceSpeedMps } from "./integrate.js";
import { advanceSpeedWithEffectMps, effectiveRiderParams, NO_EFFECT } from "./effects.js";

const base = DEFAULT_RIDER_PARAMS;

it("returns the base params by reference without an effect", () => {
  expect(effectiveRiderParams(base, NO_EFFECT, 5)).toBe(base);
});

it("aeroBoost scales only cdaM2 by 0.85", () => {
  expect(effectiveRiderParams(base, FUN_ITEMS.aeroBoost, 0)).toEqual({
    ...base,
    cdaM2: base.cdaM2 * 0.85,
  });
});

it("featherweight scales rider and bike mass by 0.9 on flat and uphill only", () => {
  const lighter = { ...base, massKg: base.massKg * 0.9, bikeMassKg: base.bikeMassKg * 0.9 };

  expect(effectiveRiderParams(base, FUN_ITEMS.featherweight, 0)).toEqual(lighter);
  expect(effectiveRiderParams(base, FUN_ITEMS.featherweight, 8)).toEqual(lighter);
  expect(effectiveRiderParams(base, FUN_ITEMS.featherweight, -0.1)).toBe(base);
});

it("tailwind changes no rider params, only the physics wind", () => {
  expect(effectiveRiderParams(base, FUN_ITEMS.tailwind, 3)).toBe(base);
  expect(advanceSpeedWithEffectMps(8, 0, 200, base, FUN_ITEMS.tailwind, 0.05)).toBe(
    advanceSpeedMps(8, 0, 200, base, -3, 0.05),
  );
});

it("without an effect the speed step equals the plain integration bit for bit", () => {
  expect(advanceSpeedWithEffectMps(8, 2, 250, base, NO_EFFECT, 0.05)).toBe(
    advanceSpeedMps(8, 2, 250, base, 0, 0.05),
  );
});

it("applies any effect, not only fun items", () => {
  expect(
    effectiveRiderParams(base, { cdaFactor: 0.5, massFactor: 1, windMps: 0 }, 0).cdaM2,
  ).toBeCloseTo(base.cdaM2 * 0.5, 12);
});
