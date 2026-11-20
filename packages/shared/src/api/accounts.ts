import { z } from "zod";

import { RiderProfileSchema } from "../profile.js";

export const ProfileInputSchema = RiderProfileSchema.extend({
  bike: RiderProfileSchema.shape.bike.strict(),
}).strict();

export const PresentProfileSchema = z
  .object({
    status: z.literal("present"),
    profile: ProfileInputSchema,
    updatedAt: z.string().datetime({ precision: 3 }),
  })
  .strict();

export const ProfileStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("missing") }).strict(),
  PresentProfileSchema,
]);

export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export type PresentProfile = z.infer<typeof PresentProfileSchema>;

export type ProfileState = z.infer<typeof ProfileStateSchema>;
