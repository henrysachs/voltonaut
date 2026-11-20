/**
 * Cycling Power Measurement 0x2A63 (Cycling Power Service 0x1818, read only).
 * Layout per GSS 3.75 and the SIG characteristic XML: flags uint16 LE, then the
 * mandatory Instantaneous Power sint16, then the optional blocks in flag order.
 * The E1 spec text places power "after the balance/torque fields"; that is a
 * transcription slip, both standards put it right after the flags.
 */

import { parseFailure, type ByteReader, type ParseResult } from "../bytes.js";

export interface CyclingPowerSample {
  readonly powerW: number;
  /** Cumulative crank revolutions; undefined without crank data. */
  readonly crankRevs: number | undefined;
  /** Last crank event time, raw uint16 in 1/1024 s; undefined without crank data. */
  readonly crankEventRaw: number | undefined;
  /** kJ accumulated; undefined when absent. */
  readonly accumulatedEnergyKj: number | undefined;
}

const FLAGS_PEDAL_POWER_BALANCE = 0x01;
const FLAGS_ACCUMULATED_TORQUE = 0x04;
const FLAGS_WHEEL_REVOLUTION_DATA = 0x10;
const FLAGS_CRANK_REVOLUTION_DATA = 0x20;
const FLAGS_EXTREME_MAGNITUDES = 0x7c0;
const FLAGS_ACCUMULATED_ENERGY = 0x800;

/**
 * Pure parse; never throws, truncated or unsupported flag combinations yield a
 * failure object. Wheel revolution data (bit 4) is consumed, not decoded.
 */
interface CrankCells {
  crankRevs: number | undefined;
  crankEventRaw: number | undefined;
}

interface EnergyCell {
  accumulatedEnergyKj: number | undefined;
}

interface CrankTail extends CrankCells, EnergyCell {
  offset: number;
}

function consumeOptionalBlocks(
  view: ByteReader,
  flags: number,
  offset: number,
): ParseResult<number> {
  let nextOffset = offset;

  if ((flags & FLAGS_PEDAL_POWER_BALANCE) !== 0) {
    nextOffset += 1;
  }

  if ((flags & FLAGS_ACCUMULATED_TORQUE) !== 0) {
    nextOffset += 2;
  }

  if ((flags & FLAGS_WHEEL_REVOLUTION_DATA) !== 0) {
    if (nextOffset + 6 > view.byteLength) {
      return parseFailure("wheel revolution data is truncated");
    }

    // Wheel revolution data (bit 4) is consumed, not decoded (spec AK5).
    nextOffset += 6;
  }

  return { ok: true, value: nextOffset };
}

function readCrankAndEnergy(
  view: ByteReader,
  flags: number,
  offset: number,
): ParseResult<CrankTail> {
  const tail: CrankTail = {
    crankRevs: undefined,
    crankEventRaw: undefined,
    accumulatedEnergyKj: undefined,
    offset,
  };

  if ((flags & FLAGS_CRANK_REVOLUTION_DATA) !== 0) {
    if (tail.offset + 4 > view.byteLength) {
      return parseFailure("crank revolution data is truncated");
    }

    tail.crankRevs = view.getUint16(tail.offset, true);
    tail.crankEventRaw = view.getUint16(tail.offset + 2, true);
    tail.offset += 4;
  }

  if ((flags & FLAGS_ACCUMULATED_ENERGY) !== 0) {
    if (tail.offset + 2 > view.byteLength) {
      return parseFailure("accumulated energy is truncated");
    }

    tail.accumulatedEnergyKj = view.getUint16(tail.offset, true);
    tail.offset += 2;
  }

  return { ok: true, value: tail };
}

/**
 * Pure parse; never throws, truncated or unsupported flag combinations yield a
 * failure object. Wheel revolution data (bit 4) is consumed, not decoded.
 */
export function parseCyclingPowerMeasurement(view: ByteReader): ParseResult<CyclingPowerSample> {
  if (view.byteLength < 4) {
    return parseFailure("cycling power measurement needs flags plus instantaneous power");
  }

  const flags = view.getUint16(0, true);

  if ((flags & FLAGS_EXTREME_MAGNITUDES) !== 0) {
    // Extreme force/torque/angle blocks (bits 6-10) are trainer-irrelevant;
    // no E1 device is expected to send them. Fail loudly instead of guessing offsets.
    return parseFailure("extreme magnitude or angle flags are not supported");
  }

  const powerW = view.getInt16(2, true);
  const afterOptional = consumeOptionalBlocks(view, flags, 4);

  if (!afterOptional.ok) {
    return afterOptional;
  }

  const tail = readCrankAndEnergy(view, flags, afterOptional.value);

  if (!tail.ok) {
    return tail;
  }

  if (tail.value.offset !== view.byteLength) {
    return parseFailure("unexpected trailing bytes after cycling power fields");
  }

  return {
    ok: true,
    value: {
      powerW,
      crankRevs: tail.value.crankRevs,
      crankEventRaw: tail.value.crankEventRaw,
      accumulatedEnergyKj: tail.value.accumulatedEnergyKj,
    },
  };
}
