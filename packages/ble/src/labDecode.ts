/**
 * Readable text for captured frames in the BLE lab. Every decoder is a public parser
 * of this package; unknown frames return "" and stay raw hex. Display only: no
 * adapter decision depends on this text.
 */

import { readerBytes, type ByteReader, type ParseResult } from "./bytes.js";
import { parseCyclingPowerMeasurement } from "./cps/parse.js";
import { parseControlResponse } from "./ftms/controlCodec.js";
import { parseFitnessMachineFeature } from "./ftms/feature.js";
import { parseIndoorBikeData } from "./ftms/parse.js";
import { parseHeartRateMeasurement } from "./hrs/parse.js";
import { DEVICE_TEXT_LABELS } from "./labLabels.js";
import type { CharacteristicRef } from "./transport.js";
import {
  BATTERY_LEVEL,
  CYCLING_POWER_MEASUREMENT,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_STATUS,
  HEART_RATE_MEASUREMENT,
  INDOOR_BIKE_DATA,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_V2_SERVICE,
} from "./uuids.js";
import { describeZwiftFrame, describeZwiftResponse } from "./zwift-play/labFrames.js";

// FTMS v1.0 table 4.16: status opcodes that the lab names; others stay numeric.
const MACHINE_STATUS = new Map([
  [0x01, "Reset"],
  [0x02, "Stopped/Paused by user"],
  [0x03, "Stopped by safety key"],
  [0x04, "Started/Resumed by user"],
  [0x07, "Target resistance changed"],
  [0x08, "Target power changed"],
  [0x12, "Indoor bike simulation changed"],
  [0xff, "Control permission lost"],
]);

/** UTF-8 text of a Device Information string, without trailing NUL bytes. */
export function decodeDeviceText(data: ByteReader): string {
  return new TextDecoder().decode(readerBytes(data)).replaceAll("\0", "").trim();
}

function machineStatus(data: ByteReader): string {
  if (data.byteLength === 0) return "";

  const opcode = data.getUint8(0);

  return MACHINE_STATUS.get(opcode) ?? `Status 0x${opcode.toString(16).padStart(2, "0")}`;
}

function controlPoint(data: ByteReader): string {
  const response = parseControlResponse(data);

  return response.ok
    ? `Antwort auf 0x${response.value.opcode.toString(16).padStart(2, "0")}: ${response.value.result}`
    : "";
}

function readable<T>(result: ParseResult<T>): string {
  return result.ok ? JSON.stringify(result.value) : result.failure.reason;
}

function standardFrame(characteristicUuid: string, data: ByteReader): string {
  switch (characteristicUuid) {
    case INDOOR_BIKE_DATA:
      return readable(parseIndoorBikeData(data));
    case HEART_RATE_MEASUREMENT:
      return readable(parseHeartRateMeasurement(data));
    case CYCLING_POWER_MEASUREMENT:
      return readable(parseCyclingPowerMeasurement(data));
    case FITNESS_MACHINE_FEATURE:
      return readable(parseFitnessMachineFeature(data));
    case FITNESS_MACHINE_STATUS:
      return machineStatus(data);
    case FITNESS_MACHINE_CONTROL_POINT:
      return controlPoint(data);
    case BATTERY_LEVEL:
      return data.byteLength === 1 ? `Akku ${data.getUint8(0)} %` : "";
    default:
      return "";
  }
}

/** Decoded text for one captured frame, or "" when no parser applies. */
export function decodeLabFrame(ref: CharacteristicRef, data: ByteReader): string {
  const zwift =
    ref.serviceUuid === ZWIFT_PLAY_LEGACY_SERVICE || ref.serviceUuid === ZWIFT_PLAY_V2_SERVICE;

  if (zwift && ref.characteristicUuid === ZWIFT_PLAY_MEASUREMENT) return describeZwiftFrame(data);

  if (zwift && ref.characteristicUuid === ZWIFT_PLAY_COMMAND_RESPONSE) {
    return describeZwiftResponse(data);
  }

  const label = DEVICE_TEXT_LABELS.get(ref.characteristicUuid);

  return label === undefined
    ? standardFrame(ref.characteristicUuid, data)
    : `${label}: ${decodeDeviceText(data)}`;
}
