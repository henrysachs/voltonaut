import { z } from "zod";

export * from "./auth.js";

export * from "./accounts.js";

export * from "./rides.js";

export * from "./strava.js";

export * from "./strava-webhook.js";

export * from "./errors.js";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
  uptimeS: z.number().finite().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
