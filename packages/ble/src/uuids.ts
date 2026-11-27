/** GATT UUID constants and normalization. Standard UUIDs use the canonical 128-bit lowercase form. */

export const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
export const BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb";
export const CYCLING_POWER_SERVICE = "00001818-0000-1000-8000-00805f9b34fb";
export const FITNESS_MACHINE_SERVICE = "00001826-0000-1000-8000-00805f9b34fb";
export const DEVICE_INFORMATION_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb";
const CYCLING_SPEED_AND_CADENCE_SERVICE = "00001816-0000-1000-8000-00805f9b34fb";

export const ZWIFT_PLAY_LEGACY_SERVICE = "00000001-19ca-4651-86e5-fa29dcdd09d1";

/** Service of the Zwift Click v2 pucks, confirmed by a GATT export on 2026-11-26. */
export const ZWIFT_PLAY_V2_SERVICE = "0000fc82-0000-1000-8000-00805f9b34fb";
export const ZWIFT_PLAY_MEASUREMENT = "00000002-19ca-4651-86e5-fa29dcdd09d1";
export const ZWIFT_PLAY_CONTROL_POINT = "00000003-19ca-4651-86e5-fa29dcdd09d1";
export const ZWIFT_PLAY_COMMAND_RESPONSE = "00000004-19ca-4651-86e5-fa29dcdd09d1";

// UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2 – purpose unknown; the lab never touches them automatically.
export const ZWIFT_CLICK_V2_UNKNOWN_CHARACTERISTICS: readonly string[] = [
  "00000100-19ca-4651-86e5-fa29dcdd09d1",
  "00000101-19ca-4651-86e5-fa29dcdd09d1",
  "00000102-19ca-4651-86e5-fa29dcdd09d1",
];

export const FITNESS_MACHINE_CONTROL_POINT = "00002ad9-0000-1000-8000-00805f9b34fb";
export const FITNESS_MACHINE_STATUS = "00002ada-0000-1000-8000-00805f9b34fb";
export const CYCLING_POWER_FEATURE = "00002a65-0000-1000-8000-00805f9b34fb";
export const CYCLING_POWER_CONTROL_POINT = "00002a66-0000-1000-8000-00805f9b34fb";
export const BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb";
export const MODEL_NUMBER = "00002a24-0000-1000-8000-00805f9b34fb";
export const SERIAL_NUMBER = "00002a25-0000-1000-8000-00805f9b34fb";
export const FIRMWARE_REVISION = "00002a26-0000-1000-8000-00805f9b34fb";
export const HARDWARE_REVISION = "00002a27-0000-1000-8000-00805f9b34fb";
export const SOFTWARE_REVISION = "00002a28-0000-1000-8000-00805f9b34fb";
export const MANUFACTURER_NAME = "00002a29-0000-1000-8000-00805f9b34fb";

export const SNIFFER_OPTIONAL_SERVICES: readonly string[] = [
  FITNESS_MACHINE_SERVICE,
  CYCLING_POWER_SERVICE,
  HEART_RATE_SERVICE,
  BATTERY_SERVICE,
  DEVICE_INFORMATION_SERVICE,
  CYCLING_SPEED_AND_CADENCE_SERVICE,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_V2_SERVICE,
];

export const HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";
export const CYCLING_POWER_MEASUREMENT = "00002a63-0000-1000-8000-00805f9b34fb";
export const FITNESS_MACHINE_FEATURE = "00002acc-0000-1000-8000-00805f9b34fb";
export const INDOOR_BIKE_DATA = "00002ad2-0000-1000-8000-00805f9b34fb";

const UUID_128_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const SHORT_HEX_PATTERN = /^(?:0x)?[0-9a-f]{1,4}$/u;

const STANDARD_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

/**
 * Normalize a UUID written as "0x1826", "1826" or a full 128-bit string to the
 * canonical lowercase 128-bit form. Short forms expand into the standard base UUID.
 * Returns undefined for anything that is not a UUID.
 */
export function normalizeUuid(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase();

  if (UUID_128_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (!SHORT_HEX_PATTERN.test(trimmed)) {
    return undefined;
  }

  const digits = trimmed.replace("0x", "").padStart(4, "0");

  return `0000${digits}${STANDARD_UUID_SUFFIX}`;
}

/** Display form: "0x1826" for standard 16-bit UUIDs, the full form otherwise. */
export function toShortUuid(uuid: string): string {
  if (uuid.length !== 36 || !uuid.endsWith(STANDARD_UUID_SUFFIX)) {
    return uuid;
  }

  return `0x${uuid.slice(4, 8)}`;
}
