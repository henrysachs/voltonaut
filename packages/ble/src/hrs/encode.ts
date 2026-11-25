/**
 * Heart Rate Measurement 0x2A37 encoder: the inverse of
 * parseHeartRateMeasurement. Synthetic fixtures and the sim strap share it.
 */

import { readOnlyBytes, type ReadOnlyBytes } from "../bytes.js";

export interface HeartRateFrame {
  readonly bpm: number;
  readonly energyKcal?: number | undefined;
  /** Raw RR intervals in 1/1024 s. */
  readonly rrRaw?: readonly number[] | undefined;
}

export function encodeHeartRateMeasurement(frame: HeartRateFrame): ReadOnlyBytes {
  const usesUint16 = frame.bpm > 0xff;

  const flags =
    (usesUint16 ? 0x01 : 0x00) |
    (frame.energyKcal === undefined ? 0x00 : 0x08) |
    (frame.rrRaw !== undefined && frame.rrRaw.length > 0 ? 0x10 : 0x00);

  const bytes = usesUint16 ? [flags, frame.bpm & 0xff, frame.bpm >> 8] : [flags, frame.bpm & 0xff];

  if (frame.energyKcal !== undefined) {
    bytes.push(frame.energyKcal & 0xff, frame.energyKcal >> 8);
  }

  for (const raw of frame.rrRaw ?? []) {
    bytes.push(raw & 0xff, raw >> 8);
  }

  return readOnlyBytes(Uint8Array.from(bytes));
}
