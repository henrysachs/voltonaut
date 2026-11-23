import { z } from "zod";

/** Effective raw readings, using the existing ride/recording sensor ranges. Not HUD EMA. */
export const RewardEffortSchema = z
  .object({
    powerW: z.number().finite().min(0).max(2000),
    cadenceRpm: z.number().finite().min(0).max(200),
  })
  .strict()
  .brand<"RewardEffort">()
  .readonly();

const aggregate = z.number().finite().min(0).max(1_000_000_000_000);

/** Numerical ceilings ensure safe integer quotes; they do not attest physical plausibility. */
export const RewardFactsSchema = z
  .object({
    activeDistanceM: aggregate,
    activeElevationGainM: aggregate,
    activeTimeS: z.number().finite().min(0).max(21_600),
    elevationGainM: aggregate,
    energyKj: aggregate,
  })
  .strict()
  .refine((facts) => facts.activeElevationGainM <= facts.elevationGainM, {
    message: "Active elevation cannot exceed total elevation",
    path: ["activeElevationGainM"],
  })
  .brand<"RewardFacts">()
  .readonly();

export const TotalXpSchema = z
  .number()
  .finite()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"TotalXp">();

export const LevelSchema = z.number().finite().int().min(1).max(50).brand<"Level">();

export const DailyVoltsBudgetSchema = z
  .number()
  .finite()
  .int()
  .min(0)
  .max(3000)
  .brand<"DailyVoltsBudget">();

const voltsComponent = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const BaseVoltsQuoteSchema = z
  .object({ work: voltsComponent, climb: voltsComponent, total: voltsComponent })
  .strict()
  .refine((quote) => quote.total === quote.work + quote.climb, {
    message: "Total Volts must equal work plus climb",
    path: ["total"],
  })
  .readonly();

export type BaseVoltsQuote = z.infer<typeof BaseVoltsQuoteSchema>;

export type RewardEffort = z.infer<typeof RewardEffortSchema>;

export type RewardFacts = z.infer<typeof RewardFactsSchema>;

export type TotalXp = z.infer<typeof TotalXpSchema>;

export type Level = z.infer<typeof LevelSchema>;

export type DailyVoltsBudget = z.infer<typeof DailyVoltsBudgetSchema>;
