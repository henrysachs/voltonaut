import { z } from "zod";

import { VoltsBalanceSchema } from "../economy.js";

export const VoltsBalanceResponseSchema = z
  .object({ voltsBalance: VoltsBalanceSchema })
  .strict()
  .readonly();

export type VoltsBalanceResponse = z.infer<typeof VoltsBalanceResponseSchema>;
