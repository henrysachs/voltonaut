import {
  EpochMsSchema,
  RewardFactsSchema,
  SeasonDefinitionSchema,
  SeasonPointsSchema,
  SeasonSectionSchema,
  type RewardFacts,
  type SeasonDefinition,
  type SeasonPoints,
  type SeasonSection,
  type SeasonTier,
} from "@voltonaut/shared";

import { calculateBaseXp } from "./xp.js";

/** Start inclusive, end exclusive (spec E6-05 AK4). */
export function isSeasonOpen(season: SeasonDefinition, atMs: number): boolean {
  const parsedSeason = SeasonDefinitionSchema.parse(season);
  const parsedAtMs = EpochMsSchema.parse(atMs);

  return (
    Date.parse(parsedSeason.startsAt) <= parsedAtMs && parsedAtMs < Date.parse(parsedSeason.endsAt)
  );
}

/**
 * Season points a section adds: the difference of whole-ride base XP before and
 * after it, so per-section rounding never drifts from the whole ride (AK3).
 */
export function ridePointsDelta(before: RewardFacts | undefined, after: RewardFacts): SeasonPoints {
  const parsedAfter = RewardFactsSchema.parse(after);

  const previous =
    before === undefined ? 0 : calculateBaseXp(RewardFactsSchema.parse(before)).total;

  const delta = calculateBaseXp(parsedAfter).total - previous;

  if (delta < 0) throw new Error("Section facts must be cumulative: after is behind before");

  return SeasonPointsSchema.parse(delta);
}

/** Highest tier whose threshold is reached; 0 below tier 1. */
export function tierForPoints(season: SeasonDefinition, points: SeasonPoints): number {
  const parsedSeason = SeasonDefinitionSchema.parse(season);
  const parsedPoints = SeasonPointsSchema.parse(points);

  return parsedSeason.tiers.filter((tier) => tier.pointsRequired <= parsedPoints).length;
}

/** Tiers with previous < threshold <= next, ascending (AK5). */
export function dueTiers(
  season: SeasonDefinition,
  previous: SeasonPoints,
  next: SeasonPoints,
): readonly SeasonTier[] {
  const parsedSeason = SeasonDefinitionSchema.parse(season);
  const parsedPrevious = SeasonPointsSchema.parse(previous);
  const parsedNext = SeasonPointsSchema.parse(next);

  if (parsedNext < parsedPrevious) throw new Error("Season points must not decrease");

  return Object.freeze(
    parsedSeason.tiers.filter(
      (tier) => parsedPrevious < tier.pointsRequired && tier.pointsRequired <= parsedNext,
    ),
  );
}

export interface SeasonSectionResult {
  readonly points: SeasonPoints;
  readonly newTiers: readonly SeasonTier[];
}

/** Applies one confirmed section; outside the season window nothing changes. */
export function applySeasonSection(section: SeasonSection): SeasonSectionResult {
  const parsed = SeasonSectionSchema.parse(section);

  if (!isSeasonOpen(parsed.season, parsed.sectionAtMs)) {
    return Object.freeze({ points: parsed.currentPoints, newTiers: Object.freeze([]) });
  }

  const points = SeasonPointsSchema.parse(
    parsed.currentPoints + ridePointsDelta(parsed.before, parsed.after),
  );

  return Object.freeze({ points, newTiers: dueTiers(parsed.season, parsed.currentPoints, points) });
}
