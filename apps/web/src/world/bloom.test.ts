import { expect, it } from "vitest";

import { peakBloom } from "./bloom.js";
import { environmentAt, nightAmount } from "./environment.js";

const CLEAR = [{ startS: 0, weather: "clear" }] as const;

it("blooms only worlds that have a night city", () => {
  expect(peakBloom([{ kind: "forest" }, { kind: "coast" }, { kind: "alpine" }])).toBe(0);
  expect(peakBloom([{ kind: "forest" }, { kind: "night-city" }])).toBeGreaterThan(0);
  expect(peakBloom([])).toBe(0);
});

it("measures the dark from the sun: none at noon, full at midnight, partial at dusk", () => {
  expect(nightAmount(environmentAt(42, 12 * 3600, CLEAR))).toBe(0);
  expect(nightAmount(environmentAt(42, 0, CLEAR))).toBe(1);

  const dusk = nightAmount(environmentAt(42, 17.5 * 3600, CLEAR));

  expect(dusk).toBeGreaterThan(0);
  expect(dusk).toBeLessThan(1);
});
