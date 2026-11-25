/**
 * Indoor Bike Data 0x2AD2 encoder: the inverse of parseIndoorBikeData for the
 * fields Voltonaut reads. Synthetic fixtures and the sim trainer build their
 * frames here so both share one byte layout with the parser.
 */

import { readOnlyBytes, type ReadOnlyBytes } from "../bytes.js";

export interface IndoorBikeFrame {
  /** Raw 0.01 km/h; absent sets the inverted "More Data" bit 0. */
  readonly speedRaw?: number | undefined;
  /** Raw 0.5 rpm. */
  readonly cadenceRaw?: number | undefined;
  readonly powerW?: number | undefined;
  readonly hrBpm?: number | undefined;
}

function uint16LE(value: number): readonly number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function encodeIndoorBikeData(frame: IndoorBikeFrame): ReadOnlyBytes {
  let flags = frame.speedRaw === undefined ? 0x01 : 0x00;
  const fields: number[] = frame.speedRaw === undefined ? [] : [...uint16LE(frame.speedRaw)];

  if (frame.cadenceRaw !== undefined) {
    flags |= 0x04;
    fields.push(...uint16LE(frame.cadenceRaw));
  }

  if (frame.powerW !== undefined) {
    flags |= 0x40;
    fields.push(...uint16LE(frame.powerW));
  }

  if (frame.hrBpm !== undefined) {
    flags |= 0x200;
    fields.push(frame.hrBpm & 0xff);
  }

  return readOnlyBytes(Uint8Array.from([...uint16LE(flags), ...fields]));
}
