import type { WebBluetoothCentral } from "./webBluetoothTypes.js";
import { z } from "zod";

const centralSchema = z.object({ requestDevice: z.function() });

export function isWebBluetoothCentral(value: unknown): value is WebBluetoothCentral {
  return centralSchema.safeParse(value).success;
}
