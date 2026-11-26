/** Human names for characteristics and advertising data in the BLE lab. Display only. */

import { toHex } from "./bytes.js";
import type { AdvertisementFrame } from "./transport.js";
import {
  normalizeUuid,
  toShortUuid,
  BATTERY_LEVEL,
  CYCLING_POWER_CONTROL_POINT,
  CYCLING_POWER_FEATURE,
  CYCLING_POWER_MEASUREMENT,
  FIRMWARE_REVISION,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_STATUS,
  HARDWARE_REVISION,
  HEART_RATE_MEASUREMENT,
  INDOOR_BIKE_DATA,
  MANUFACTURER_NAME,
  MODEL_NUMBER,
  SERIAL_NUMBER,
  SOFTWARE_REVISION,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_MEASUREMENT,
} from "./uuids.js";

/** Device Information strings; their value is UTF-8 text. */
export const DEVICE_TEXT_LABELS = new Map([
  [MODEL_NUMBER, "Modell"],
  [SERIAL_NUMBER, "Seriennummer"],
  [FIRMWARE_REVISION, "Firmware"],
  [HARDWARE_REVISION, "Hardware"],
  [SOFTWARE_REVISION, "Software"],
  [MANUFACTURER_NAME, "Hersteller"],
]);

const CHARACTERISTIC_LABELS = new Map([
  [INDOOR_BIKE_DATA, "Indoor Bike Data"],
  [FITNESS_MACHINE_CONTROL_POINT, "FTMS Control Point"],
  [FITNESS_MACHINE_STATUS, "FTMS Status"],
  [FITNESS_MACHINE_FEATURE, "FTMS Fähigkeiten"],
  ["00002ad6-0000-1000-8000-00805f9b34fb", "Widerstandsbereich"],
  ["00002ad8-0000-1000-8000-00805f9b34fb", "Leistungsbereich"],
  [HEART_RATE_MEASUREMENT, "Herzfrequenz"],
  [CYCLING_POWER_MEASUREMENT, "Cycling Power"],
  [CYCLING_POWER_FEATURE, "CPS Fähigkeiten"],
  [CYCLING_POWER_CONTROL_POINT, "CPS Control Point"],
  [BATTERY_LEVEL, "Akku"],
  [ZWIFT_PLAY_MEASUREMENT, "Zwift Daten"],
  [ZWIFT_PLAY_CONTROL_POINT, "Zwift Befehl"],
  [ZWIFT_PLAY_COMMAND_RESPONSE, "Zwift Antwort"],
]);

/** Short human name of a characteristic for log lines; unknown ones keep their UUID. */
export function characteristicLabel(uuid: string): string {
  const normalized = normalizeUuid(uuid) ?? uuid;

  return (
    CHARACTERISTIC_LABELS.get(normalized) ??
    DEVICE_TEXT_LABELS.get(normalized) ??
    toShortUuid(normalized)
  );
}

const ZWIFT_COMPANY_ID = 0x094a;

// UNVERIFIED: docs/02-bluetooth.md#erkennung – device type byte after the Zwift company id.
const ZWIFT_DEVICE_TYPES = new Map([
  [0x01, "Zwift Hub"],
  [0x02, "Zwift Play rechts"],
  [0x03, "Zwift Play links"],
  [0x07, "Zwift Ride rechts"],
  [0x08, "Zwift Ride links"],
  [0x09, "Zwift Click"],
  [0x0a, "Zwift Click v2 rechts (+)"],
  [0x0b, "Zwift Click v2 links (−)"],
  [0x0e, "Zwift Play (Firmware 2)"],
]);

/** Readable advertising summary; the Zwift device type tells pucks and grips apart. */
export function describeAdvertisement(frame: AdvertisementFrame): string {
  const lines: string[] = [];

  if (frame.rssiDbm !== undefined) lines.push(`Signal: ${frame.rssiDbm} dBm`);

  for (const entry of frame.manufacturerData) {
    const type =
      entry.companyId === ZWIFT_COMPANY_ID
        ? ZWIFT_DEVICE_TYPES.get(entry.data.at(0) ?? -1)
        : undefined;

    lines.push(
      `Hersteller 0x${entry.companyId.toString(16).padStart(4, "0")}: ${toHex(entry.data)}${type === undefined ? "" : ` → ${type}`}`,
    );
  }

  for (const entry of frame.serviceData) {
    lines.push(`Service-Daten ${toShortUuid(entry.serviceUuid)}: ${toHex(entry.data)}`);
  }

  return lines.length === 0 ? "Advertising ohne Inhalt" : lines.join("\n");
}
