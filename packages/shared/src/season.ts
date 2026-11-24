import { z } from "zod";

import { RewardFactsSchema } from "./rewards.js";

const DAY_MS = 86_400_000;

/** Season length bounds from issue #44: 8 to 12 weeks. */
export const SEASON_MIN_DAYS = 56;
export const SEASON_MAX_DAYS = 84;
export const SEASON_MIN_TIERS = 20;

export const SeasonIdSchema = z.string().regex(/^season-\d{2}$/u);

const seasonPointsValue = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const SeasonPointsSchema = seasonPointsValue.brand<"SeasonPoints">();

export const SeasonRewardSchema = z.union([
  z
    .object({ kind: z.literal("item"), itemId: z.string().trim().min(1).max(120) })
    .strict()
    .readonly(),
  z
    .object({ kind: z.literal("volts"), amount: z.number().finite().int().min(1).max(10_000) })
    .strict()
    .readonly(),
]);

export const SeasonTierSchema = z
  .object({
    tier: z.number().finite().int().min(1),
    pointsRequired: seasonPointsValue,
    rewards: z.array(SeasonRewardSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

const isoUtc = z.string().datetime({ offset: false });

type SeasonFields = {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly tiers: readonly { readonly tier: number; readonly pointsRequired: number }[];
};

function validateSeason(
  season: SeasonFields,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod owns this callback context; validation only calls addIssue.
  context: Readonly<z.RefinementCtx>,
): void {
  const durationDays = (Date.parse(season.endsAt) - Date.parse(season.startsAt)) / DAY_MS;

  if (durationDays < SEASON_MIN_DAYS || durationDays > SEASON_MAX_DAYS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Season must last ${SEASON_MIN_DAYS} to ${SEASON_MAX_DAYS} days`,
      path: ["endsAt"],
    });
  }

  for (const [index, tier] of season.tiers.entries()) {
    if (tier.tier !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tiers must be numbered 1..n without gaps",
        path: ["tiers", index, "tier"],
      });
    }

    const previousPoints = season.tiers[index - 1]?.pointsRequired ?? 0;

    if (tier.pointsRequired <= previousPoints) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tier thresholds must be positive and strictly increasing",
        path: ["tiers", index, "pointsRequired"],
      });
    }
  }
}

export const SeasonDefinitionSchema = z
  .object({
    id: SeasonIdSchema,
    name: z.string().trim().min(1).max(60),
    startsAt: isoUtc,
    endsAt: isoUtc,
    tiers: z.array(SeasonTierSchema).min(SEASON_MIN_TIERS).readonly(),
  })
  .strict()
  .superRefine(validateSeason)
  .readonly();

/** Millisecond timestamp; rules receive time explicitly instead of reading a clock. */
export const EpochMsSchema = z.number().finite().int().min(0).max(8_640_000_000_000_000);

/** One confirmed ride section: cumulative ride facts before and after it, and when it was ridden. */
export const SeasonSectionSchema = z
  .object({
    season: SeasonDefinitionSchema,
    currentPoints: SeasonPointsSchema,
    before: RewardFactsSchema.optional(),
    after: RewardFactsSchema,
    /** Ride time at which the section starts; decides the season window (spec E6-05 AK4). */
    sectionAtMs: EpochMsSchema,
  })
  .strict()
  .readonly();

export type SeasonSection = z.input<typeof SeasonSectionSchema>;

export type SeasonPoints = z.infer<typeof SeasonPointsSchema>;

export type SeasonReward = z.infer<typeof SeasonRewardSchema>;

export type SeasonTier = z.infer<typeof SeasonTierSchema>;

export type SeasonDefinition = z.infer<typeof SeasonDefinitionSchema>;
