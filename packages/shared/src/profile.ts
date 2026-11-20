import { z } from "zod";

/** Rider profile per docs/03-engine-physics.md section 2a; E5 reuses this as PUT /v1/me/profile. */
export const RiderProfileSchema = z.object({
  displayName: z.string().min(1).max(40),
  massKg: z.number().finite().min(30).max(200),
  heightCm: z.number().finite().min(120).max(220),
  /** Reserved for poses/zones/workouts (E10); no UI field in E3. */
  ftpW: z.number().finite().int().min(0).max(1000).optional(),
  /** Reserved for HR zones; no UI field in E3. */
  maxHrBpm: z.number().finite().int().min(60).max(260).optional(),
  bike: z.object({
    massKg: z.number().finite().min(1).max(30),
    chainringTeeth: z.number().int().min(28).max(60),
    cogTeeth: z.number().int().min(10).max(23),
    wheelCircM: z.number().finite().min(1.9).max(2.4),
  }),
  gearPreset: z.literal("zwift-like-24"),
  units: z.enum(["metric", "imperial"]),
});

export type RiderProfile = z.infer<typeof RiderProfileSchema>;

/** Versioned record for the local IndexedDB cache (schemaVersion 1); E5 migrates it into the account. */
export const StoredProfileRecordSchema = z.object({
  schemaVersion: z.literal(1),
  profile: RiderProfileSchema,
});

export type StoredProfileRecord = z.infer<typeof StoredProfileRecordSchema>;

/** Default profile: 75 kg rider, 185 cm, 8 kg bike, 42/14 with Zwift Cog, 700x25c wheels. */
export const DEFAULT_RIDER_PROFILE: RiderProfile = {
  displayName: "Rider",
  massKg: 75,
  heightCm: 185,
  bike: {
    massKg: 8,
    chainringTeeth: 42,
    cogTeeth: 14,
    wheelCircM: 2.105,
  },
  gearPreset: "zwift-like-24",
  units: "metric",
};
