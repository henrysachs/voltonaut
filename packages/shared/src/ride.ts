import { z } from "zod";

import type { Bpm, Meters, Mps, Pct, Rpm, Seconds, Watts } from "./units.js";

import { RiderProfileSchema } from "./profile.js";

/** FTMS 0x11 simulation mode command (grade, wind, roll and aero coefficients). */
export type TrainerCommand =
  | {
      readonly type: "simulation";
      readonly gradePct: Pct;
      readonly windMps: Mps;
      readonly crr: number;
      readonly cwKgPerM: number;
    }
  | { readonly type: "targetPower"; readonly powerW: Watts }
  | { readonly type: "resistance"; readonly level: number };

export interface RideSummary {
  readonly distanceM: Meters;
  readonly elevationGainM: Meters;
  readonly energyKj: number;
  readonly tS: Seconds;
}

/** Discrete engine output events; consumed by game/, ui/ and later the server. */
export type RideEvent =
  | { readonly type: "ride.started" }
  | { readonly type: "ride.ended"; readonly summary: RideSummary }
  | { readonly type: "gear.changed"; readonly from: number; readonly to: number }
  | { readonly type: "distance.tick"; readonly deltaM: Meters; readonly deltaElevM: Meters }
  | {
      readonly type: "segment.entered" | "segment.exited";
      readonly segmentId: string;
      readonly tS: Seconds;
    }
  | { readonly type: "lap.completed"; readonly lap: number; readonly tS: Seconds }
  | { readonly type: "ride.clockSkipped"; readonly skippedS: Seconds };

/** Raw per-tick engine inputs; physics uses these unsmoothed values. */
export interface TickInputs {
  readonly powerW: Watts;
  readonly cadenceRpm: Rpm;
  readonly hrBpm: Bpm | undefined;
  /** Shift intents accumulated since the last tick: +n up, -n down. */
  readonly shifts: number;
  /** Whether a trainer.data event arrived since the last tick. */
  readonly trainerDataFresh: boolean;
}

/** Trainer resistance strategy; E3 implements effectiveGrade (FTMS 0x11). */
export const TrainerStrategySchema = z.literal("effectiveGrade");

export type TrainerStrategy = z.infer<typeof TrainerStrategySchema>;

/** One 1 Hz row of a scripted ride (golden fixtures and later ride uploads). */
export const RideSampleSchema = z.object({
  tS: z.number().finite().nonnegative(),
  powerW: z.number().finite().min(0).max(2000),
  cadenceRpm: z.number().finite().min(0).max(200),
  hrBpm: z.number().int().min(30).max(250).optional(),
  shift: z.number().int().min(-24).max(24).optional(),
});

export type RideSample = z.infer<typeof RideSampleSchema>;

/** Input format of fixtures/rides/<name>.input.json (docs/10-testing.md section 3). */
export const RideInputSchema = z.object({
  routeId: z.string().min(1),
  profile: RiderProfileSchema,
  trainerStrategy: TrainerStrategySchema,
  initial: z.object({
    gearIndex: z.number().int().min(0).max(23),
    speedMps: z.number().finite().min(0),
    routePosM: z.number().finite().min(0),
  }),
  samples: z.array(RideSampleSchema).min(1),
});

export type RideInput = z.infer<typeof RideInputSchema>;

/** Baseline format of fixtures/rides/<name>.golden.json (docs/10-testing.md section 3). */
export const RideGoldenSchema = z.object({
  distanceM: z.number(),
  elevationGainM: z.number(),
  energyKj: z.number(),
  tS: z.number(),
  endSpeedMps: z.number(),
  laps: z.number().int(),
  segments: z.array(
    z.object({
      segmentId: z.string(),
      lap: z.number().int(),
      enteredTS: z.number(),
      exitedTS: z.number().nullable(),
    }),
  ),
  commandCount: z.number().int(),
  commandHash: z.string().regex(/^[0-9a-f]{64}$/u),
  schemaVersion: z.literal(1),
});

export type RideGolden = z.infer<typeof RideGoldenSchema>;
