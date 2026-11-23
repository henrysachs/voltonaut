import { RewardEffortSchema, type RewardEffort, type RewardFacts } from "@voltonaut/shared";

export function isXpActive(effort: RewardEffort): boolean {
  const parsedEffort = RewardEffortSchema.parse(effort);

  return parsedEffort.powerW > 30 && parsedEffort.cadenceRpm > 20;
}

export function calculateBaseXp(facts: RewardFacts) {
  const distance = Math.floor(facts.activeDistanceM / 50);
  const elevation = Math.floor(facts.activeElevationGainM * 2);
  const time = Math.floor(facts.activeTimeS / 60);

  return Object.freeze({ distance, elevation, time, total: distance + elevation + time });
}
