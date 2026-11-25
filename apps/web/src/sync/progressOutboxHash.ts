import type { ProgressCheckpointBatch } from "@voltonaut/shared";

import { LocalProgressBatchSchema } from "./progressBatch.js";

const encoder = new TextEncoder();

/**
 * Hashes a batch that already is a `LocalProgressBatchSchema` output or was built from such outputs
 * in schema key order. Skipping the re-parse keeps appends linear in batch size; raw input must use
 * `progressPayloadHash`.
 */
export function hashValidatedProgressPayload(parsed: Readonly<ProgressCheckpointBatch>): string {
  let left = 0x811c9dc5;
  let right = 0x85ebca6b;

  for (const byte of encoder.encode(JSON.stringify(parsed))) {
    left = Math.imul(left ^ byte, 0x01000193) >>> 0;
    right = Math.imul(right ^ byte, 0x01000193) >>> 0;
  }

  return left.toString(16).padStart(8, "0") + right.toString(16).padStart(8, "0");
}

/** Stable integrity fingerprint for idempotency, not an authenticity signature. */
export function progressPayloadHash(payload: Readonly<ProgressCheckpointBatch>): string {
  return hashValidatedProgressPayload(LocalProgressBatchSchema.parse(payload));
}
