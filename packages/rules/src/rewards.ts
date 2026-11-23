import { RewardFactsSchema, type RewardFacts } from "@voltonaut/shared";

import { calculateBaseVolts } from "./economy.js";
import { calculateBaseXp } from "./xp.js";

export function calculateBaseRewards(facts: RewardFacts) {
  const parsedFacts = RewardFactsSchema.parse(facts);

  return Object.freeze({
    kind: "base_quote",
    xp: calculateBaseXp(parsedFacts),
    volts: calculateBaseVolts(parsedFacts),
  });
}

export type BaseRewardQuote = ReturnType<typeof calculateBaseRewards>;
