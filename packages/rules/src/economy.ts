import {
  BaseVoltsQuoteSchema,
  DailyVoltsBudgetSchema,
  type BaseVoltsQuote,
  type DailyVoltsBudget,
  type RewardFacts,
} from "@voltonaut/shared";

export function calculateBaseVolts(facts: RewardFacts) {
  const work = Math.floor(facts.energyKj);
  const climb = Math.floor(facts.elevationGainM * 1.5);

  return Object.freeze({ work, climb, total: work + climb });
}

export function applyDailyLimit(candidate: BaseVoltsQuote, budget: DailyVoltsBudget) {
  const parsedCandidate = BaseVoltsQuoteSchema.parse(candidate);
  const parsedBudget = DailyVoltsBudgetSchema.parse(budget);
  const quotedVolts = Math.min(parsedCandidate.total, parsedBudget);

  return Object.freeze({
    quotedVolts,
    withheldVolts: parsedCandidate.total - quotedVolts,
    remainingVolts: parsedBudget - quotedVolts,
  });
}

export type DailyVoltsQuote = ReturnType<typeof applyDailyLimit>;
