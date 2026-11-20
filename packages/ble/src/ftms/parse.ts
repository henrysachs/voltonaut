/**
 * Indoor Bike Data 0x2AD2 (Fitness Machine Service 0x1826).
 * Field layout per GSS 3.139 (2026-09-09) and the E1 spec: flags uint16 LE,
 * then the optional fields in fixed order. Bit 0 "More Data" is inverted
 * (speed is present when bit 0 is 0).
 */

import { parseFailure, readUint24LE, type ByteReader, type ParseResult } from "../bytes.js";

export interface IndoorBikeSample {
  /** m/s (raw 0.01 km/h); undefined when the field is absent. */
  readonly speedMps: number | undefined;
  /** rpm (raw 0.5 rpm); undefined when the field is absent. */
  readonly cadenceRpm: number | undefined;
  /** W (raw sint16 W); undefined when the field is absent. */
  readonly powerW: number | undefined;
  /** bpm (raw uint8); undefined when the field is absent. */
  readonly hrBpm: number | undefined;
  /** m since session start (raw uint24 LE); undefined when the field is absent. */
  readonly totalDistanceM: number | undefined;
  /** kCal total (first pair of the 5-octet energy block); undefined when the
   * block is absent or the device signals "data not available" (0xFFFF). */
  readonly energyKcal: number | undefined;
}

/** FTMS v1.0 4.9.1.10: 0xFFFF means the server cannot calculate total energy. */
const ENERGY_NOT_AVAILABLE = 0xffff;

type FieldKey =
  | "speed"
  | "averageSpeed"
  | "cadence"
  | "averageCadence"
  | "totalDistance"
  | "resistance"
  | "power"
  | "averagePower"
  | "energy"
  | "hr"
  | "met"
  | "elapsed"
  | "remaining";

interface FieldSpec {
  readonly bit: number;
  readonly key: FieldKey;
  readonly octets: number;
}

/**
 * Fixed field order. Bit 0 is inverted: speed appears when bit 0 is 0.
 * Bit 2 "Instantaneous Cadence" follows the GSS layout, not the FTMS v1.0 table
 * (which swaps bits 1 and 2); the E1 hardware fixture is the final referee.
 * // UNVERIFIED: docs/02-bluetooth.md#2 (Bit-2-Kadenz, Errata 23224) bis die Hardware-Fixture vorliegt.
 * The resistance field is sint16 per FTMS v1.0; the current GSS lists it as uint8.
 * // UNVERIFIED: docs/02-bluetooth.md#2 (Resistance-Level-Breite) bis die Hardware-Fixture vorliegt.
 */
const FIELDS: readonly FieldSpec[] = [
  { bit: 0, key: "speed", octets: 2 },
  { bit: 1, key: "averageSpeed", octets: 2 },
  { bit: 2, key: "cadence", octets: 2 },
  { bit: 3, key: "averageCadence", octets: 2 },
  { bit: 4, key: "totalDistance", octets: 3 },
  { bit: 5, key: "resistance", octets: 2 },
  { bit: 6, key: "power", octets: 2 },
  { bit: 7, key: "averagePower", octets: 2 },
  { bit: 8, key: "energy", octets: 5 },
  { bit: 9, key: "hr", octets: 1 },
  { bit: 10, key: "met", octets: 1 },
  { bit: 11, key: "elapsed", octets: 2 },
  { bit: 12, key: "remaining", octets: 2 },
];

function isPresent(spec: FieldSpec, flags: number): boolean {
  if (spec.bit === 0) {
    return (flags & 0x01) === 0;
  }

  return (flags & (1 << spec.bit)) !== 0;
}

/** Speed raw is 0.01 km/h; convert to SI m/s. */
function rawToSpeedMps(raw: number): number {
  return raw / 360;
}

function readField(view: ByteReader, spec: FieldSpec, offset: number): Partial<IndoorBikeSample> {
  switch (spec.key) {
    case "speed":
      return { speedMps: rawToSpeedMps(view.getUint16(offset, true)) };
    case "cadence":
      return { cadenceRpm: view.getUint16(offset, true) * 0.5 };
    case "power":
      return { powerW: view.getInt16(offset, true) };
    case "totalDistance":
      return { totalDistanceM: readUint24LE(view, offset) };
    case "hr":
      return { hrBpm: view.getUint8(offset) };
    case "energy": {
      const totalKcal = view.getUint16(offset, true);

      return { energyKcal: totalKcal === ENERGY_NOT_AVAILABLE ? undefined : totalKcal };
    }

    case "averageSpeed":
    case "averageCadence":
    case "resistance":
    case "averagePower":
    case "met":
    case "elapsed":
    case "remaining":
      break;
  }

  return {};
}

/** Pure parse; never throws, malformed input yields a failure object. */
export function parseIndoorBikeData(view: ByteReader): ParseResult<IndoorBikeSample> {
  if (view.byteLength < 2) {
    return parseFailure("indoor bike data needs at least the 2 flag bytes");
  }

  const flags = view.getUint16(0, true);

  const cells: IndoorBikeSample = {
    speedMps: undefined,
    cadenceRpm: undefined,
    powerW: undefined,
    hrBpm: undefined,
    totalDistanceM: undefined,
    energyKcal: undefined,
  };

  let offset = 2;

  for (const spec of FIELDS) {
    if (!isPresent(spec, flags)) {
      continue;
    }

    if (offset + spec.octets > view.byteLength) {
      return parseFailure(`field ${spec.key} is truncated`);
    }

    Object.assign(cells, readField(view, spec, offset));
    offset += spec.octets;
  }

  if (offset !== view.byteLength) {
    return parseFailure("unexpected trailing bytes after indoor bike fields");
  }

  return {
    ok: true,
    value: {
      speedMps: cells.speedMps,
      cadenceRpm: cells.cadenceRpm,
      powerW: cells.powerW,
      hrBpm: cells.hrBpm,
      totalDistanceM: cells.totalDistanceM,
      energyKcal: cells.energyKcal,
    },
  };
}
