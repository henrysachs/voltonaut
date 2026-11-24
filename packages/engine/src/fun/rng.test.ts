import { expect, it } from "vitest";

import { nextRandom, pickItem } from "./rng.js";

function draws(seed: number, count: number): readonly number[] {
  let state = seed;

  return Array.from({ length: count }, () => {
    const result = nextRandom(state);

    state = result.state;

    return result.value;
  });
}

it("is deterministic for a seed and differs between seeds", () => {
  expect(draws(42, 5)).toEqual(draws(42, 5));
  expect(draws(42, 5)).not.toEqual(draws(43, 5));
});

it("matches the published mulberry32 sequence for seed 42", () => {
  expect(draws(42, 3).map((value) => value.toFixed(10))).toEqual([
    "0.6011037519",
    "0.4482905590",
    "0.8524657935",
  ]);
});

it("stays in [0, 1) and spreads evenly over 10 000 draws", () => {
  const values = draws(7, 10_000);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

  expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...values)).toBeLessThan(1);
  expect(mean).toBeGreaterThan(0.48);
  expect(mean).toBeLessThan(0.52);
});

it("100 seeded picks repeat exactly and use every item", () => {
  const picks = draws(42, 100).map((value) => pickItem(value));

  expect(draws(42, 100).map((value) => pickItem(value))).toEqual(picks);
  expect(new Set(picks)).toEqual(new Set(["aeroBoost", "featherweight", "tailwind"]));
});

it("pickItem clamps values outside [0, 1) to the first and last item", () => {
  expect([-0.5, 1, 1.5].map((value) => pickItem(value))).toEqual([
    "aeroBoost",
    "tailwind",
    "tailwind",
  ]);
});

it("pickItem splits [0, 1) into equal thirds in FUN_ITEM_IDS order", () => {
  expect([0, 0.3333, 0.3334, 0.6666, 0.6667, 0.9999].map((value) => pickItem(value))).toEqual([
    "aeroBoost",
    "aeroBoost",
    "featherweight",
    "featherweight",
    "tailwind",
    "tailwind",
  ]);
});
