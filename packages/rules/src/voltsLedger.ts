import {
  BaseVoltsQuoteSchema,
  RewardFactsSchema,
  VoltsBalanceSchema,
  VoltsDeltaSchema,
  type BaseVoltsQuote,
  type RewardFacts,
  type VoltsBalance,
  type VoltsDelta,
} from "@voltonaut/shared";

import { calculateBaseRewards } from "./rewards.js";

export type VoltsDeltaApplication =
  | Readonly<{ kind: "applied"; balance: VoltsBalance }>
  | Readonly<{ kind: "insufficient_volts"; balance: VoltsBalance }>;

export type VoltsIncrementQuote =
  | Readonly<{ kind: "increment"; cumulative: BaseVoltsQuote; increment: BaseVoltsQuote }>
  | Readonly<{ kind: "regressed"; cumulative: BaseVoltsQuote }>;

export function applyVoltsDelta(balance: VoltsBalance, delta: VoltsDelta): VoltsDeltaApplication {
  const parsedBalance = VoltsBalanceSchema.parse(balance);
  const parsedDelta = VoltsDeltaSchema.parse(delta);
  const result = parsedBalance + parsedDelta;

  if (result < 0) {
    return Object.freeze({ kind: "insufficient_volts", balance: parsedBalance });
  }

  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Volts balance exceeds the safe integer range");
  }

  return Object.freeze({ kind: "applied", balance: VoltsBalanceSchema.parse(result) });
}

export function hasRewardFactsRegressed(previous: RewardFacts, current: RewardFacts): boolean {
  const parsedPrevious = RewardFactsSchema.parse(previous);
  const parsedCurrent = RewardFactsSchema.parse(current);

  return (
    parsedCurrent.activeDistanceM < parsedPrevious.activeDistanceM ||
    parsedCurrent.activeElevationGainM < parsedPrevious.activeElevationGainM ||
    parsedCurrent.activeTimeS < parsedPrevious.activeTimeS ||
    parsedCurrent.elevationGainM < parsedPrevious.elevationGainM ||
    parsedCurrent.energyKj < parsedPrevious.energyKj
  );
}

export function quoteVoltsIncrement(
  previous: BaseVoltsQuote,
  cumulativeFacts: RewardFacts,
): VoltsIncrementQuote {
  const parsedPrevious = BaseVoltsQuoteSchema.parse(previous);
  const parsedFacts = RewardFactsSchema.parse(cumulativeFacts);
  const cumulative = calculateBaseRewards(parsedFacts).volts;

  if (cumulative.work < parsedPrevious.work || cumulative.climb < parsedPrevious.climb) {
    return Object.freeze({ kind: "regressed", cumulative });
  }

  const work = cumulative.work - parsedPrevious.work;
  const climb = cumulative.climb - parsedPrevious.climb;
  const increment = BaseVoltsQuoteSchema.parse({ work, climb, total: work + climb });

  return Object.freeze({ kind: "increment", cumulative, increment });
}
