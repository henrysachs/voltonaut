/** GATT UUID constants and normalization. Standard UUIDs use the canonical 128-bit lowercase form. */

export const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
export const BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb";
export const CYCLING_POWER_SERVICE = "00001818-0000-1000-8000-00805f9b34fb";
export const FITNESS_MACHINE_SERVICE = "00001826-0000-1000-8000-00805f9b34fb";

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
