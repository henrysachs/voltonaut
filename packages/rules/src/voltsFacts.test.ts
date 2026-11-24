import { describe, expect, it } from "vitest";

import { RewardFactsSchema } from "@voltonaut/shared";

import { hasRewardFactsRegressed } from "./index.js";

const zero = RewardFactsSchema.parse({
  activeDistanceM: 0,
  activeElevationGainM: 0,
  activeTimeS: 0,
  elevationGainM: 0,
  energyKj: 0,
});

describe("hasRewardFactsRegressed", () => {
  it("rejects a decrease in any cumulative fact field", () => {
    const previous = RewardFactsSchema.parse({
      activeDistanceM: 10,
      activeElevationGainM: 4,
      activeTimeS: 20,
      elevationGainM: 6,
      energyKj: 5.9,
    });

    for (const current of [
      { ...previous, activeDistanceM: 9.9 },
      { ...previous, activeElevationGainM: 3.9 },
      { ...previous, activeTimeS: 19.9 },
      { ...previous, elevationGainM: 5.9 },
      { ...previous, energyKj: 5.8 },
    ]) {
      expect(hasRewardFactsRegressed(previous, current)).toBe(true);
    }
  });

  it("accepts unchanged and increasing cumulative facts", () => {
    expect(hasRewardFactsRegressed(zero, zero)).toBe(false);
    expect(
      hasRewardFactsRegressed(zero, {
        ...zero,
        activeDistanceM: 1,
        activeElevationGainM: 1,
        activeTimeS: 1,
        elevationGainM: 1,
        energyKj: 1,
      }),
    ).toBe(false);
  });
});
