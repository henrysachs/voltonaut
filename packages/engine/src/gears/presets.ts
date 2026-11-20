/**
 * Zwift-like 24-gear single-step progression from docs/03-engine-physics.md section 3.
 *
 * Anchors verified against Zwift Insider: gear 1 = 0.75, gear 14 = 2.82,
 * gear 24 = 5.49; intermediate values are the geometric interpolation between
 * those anchors (~+10.7 % per step below 14, ~+6.9 % above).
 * UNVERIFIED: docs/02-bluetooth.md is not involved here; the intermediate ratios
 * only affect trainer resistance feel and are recalibrated with E2.
 */
export const GEAR_RATIOS: readonly number[] = [
  0.75, 0.83, 0.92, 1.02, 1.13, 1.25, 1.38, 1.53, 1.69, 1.88, 2.08, 2.3, 2.55, 2.82, 3.01, 3.22,
  3.44, 3.68, 3.93, 4.21, 4.5, 4.81, 5.14, 5.49,
];

export type GearPresetId = "zwift-like-24";

export interface GearPreset {
  readonly id: GearPresetId;
  readonly ratios: readonly number[];
}

export const ZWIFT_LIKE_24_PRESET: GearPreset = { id: "zwift-like-24", ratios: GEAR_RATIOS };

/** Registry of known gear presets; E10 adds more (e.g. a road 2x12). */
export const GEAR_PRESETS = {
  "zwift-like-24": ZWIFT_LIKE_24_PRESET,
} satisfies Readonly<Record<string, GearPreset>>;

/** Zero-based default start gear (12 in the one-based HUD numbering). */
export const START_GEAR_INDEX = 11;

/** Real drivetrain ratio at the trainer: chainring / cog (Zwift Cog default 14 teeth). */
export function physicalRatioFor(chainringTeeth: number, cogTeeth: number): number {
  return chainringTeeth / cogTeeth;
}
