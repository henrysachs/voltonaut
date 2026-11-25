import type { ProgressCheckpointBatch } from "@voltonaut/shared";

import { LocalProgressBatchSchema } from "./progressBatch.js";

const encoder = new TextEncoder();

/** Stable integrity fingerprint for idempotency, not an authenticity signature. */
export function progressPayloadHash(payload: Readonly<ProgressCheckpointBatch>): string {
  const parsed = LocalProgressBatchSchema.parse(payload);
  let left = 0x811c9dc5;
  let right = 0x85ebca6b;

  for (const byte of encoder.encode(JSON.stringify(parsed))) {
    left = Math.imul(left ^ byte, 0x01000193) >>> 0;
    right = Math.imul(right ^ byte, 0x01000193) >>> 0;
  }

  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}
