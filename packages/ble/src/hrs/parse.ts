/**
 * Heart Rate Measurement 0x2A37 (Heart Rate Service 0x180D).
 * Layout per GSS 3.126 / Heart Rate Service 1.0: uint8 flags, then heart rate,
 * then optional energy and RR intervals in flag order.
 */

import { parseFailure, type ByteReader, type ParseResult } from "../bytes.js";

export type SensorContact = "notSupported" | "noContact" | "contact";

export interface HeartRateSample {
  readonly bpm: number;
  readonly contact: SensorContact;
  /** kCal since session start; undefined when the flag is unset. */
  readonly energyKcal: number | undefined;
  /** RR intervals in ms (raw uint16 in 1/1024 s); empty when the flag is unset. */
  readonly rrMs: readonly number[];
}

const FLAGS_HR_UINT16 = 0x01;
const FLAGS_CONTACT_DETECTED = 0x02;
const FLAGS_CONTACT_SUPPORTED = 0x04;
const FLAGS_ENERGY = 0x08;
const FLAGS_RR_INTERVALS = 0x10;

function contactState(flags: number): SensorContact {
  if ((flags & FLAGS_CONTACT_SUPPORTED) === 0) {
    return "notSupported";
  }

  return (flags & FLAGS_CONTACT_DETECTED) === 0 ? "noContact" : "contact";
}

/** Pure parse; never throws, truncated input yields a failure object. */
export function parseHeartRateMeasurement(view: ByteReader): ParseResult<HeartRateSample> {
  if (view.byteLength < 2) {
    return parseFailure("heart rate measurement needs at least 2 bytes");
  }

  const flags = view.getUint8(0);
  const usesUint16Hr = (flags & FLAGS_HR_UINT16) !== 0;
  let offset = 1;

  if (usesUint16Hr && view.byteLength < 3) {
    return parseFailure("uint16 heart rate field is truncated");
  }

  const bpm = usesUint16Hr ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += usesUint16Hr ? 2 : 1;

  let energyKcal: number | undefined;

  if ((flags & FLAGS_ENERGY) !== 0) {
    if (offset + 2 > view.byteLength) {
      return parseFailure("energy field is truncated");
    }

    energyKcal = view.getUint16(offset, true);
    offset += 2;
  }

  const rrMs: number[] = [];

  if ((flags & FLAGS_RR_INTERVALS) !== 0) {
    if ((view.byteLength - offset) % 2 !== 0) {
      return parseFailure("rr interval list is truncated");
    }

    while (offset + 2 <= view.byteLength) {
      const raw = view.getUint16(offset, true);
      rrMs.push((raw * 1000) / 1024);
      offset += 2;
    }
  }

  if (offset !== view.byteLength) {
    return parseFailure("unexpected trailing bytes after heart rate fields");
  }

  return {
    ok: true,
    value: { bpm, contact: contactState(flags), energyKcal, rrMs },
  };
}
