/**
 * Transport seam between device adapters and a GATT implementation
 * (Web Bluetooth in the browser, ReplayTransport in tests and the sniffer's
 * replay mode). All UUIDs are the canonical lowercase 128-bit form.
 */

import type { ByteReader, ReadOnlyBytes } from "./bytes.js";

export type GattProperty = "read" | "write" | "writeWithoutResponse" | "notify" | "indicate";

export type GattWriteMode = "withResponse" | "withoutResponse";

export interface CharacteristicInfo {
  readonly uuid: string;
  readonly properties: readonly GattProperty[];
  readonly descriptors: readonly string[];
}

export interface ServiceInfo {
  readonly uuid: string;
  readonly characteristics: readonly CharacteristicInfo[];
}

export interface GattProfile {
  readonly services: readonly ServiceInfo[];
}

export interface CharacteristicRef {
  readonly serviceUuid: string;
  readonly characteristicUuid: string;
}

/**
 * One picker filter; a device matches when it satisfies any filter of the scan.
 * A name-only filter finds devices that do not advertise their service UUIDs;
 * every service used afterwards must still be listed in `optionalServices`.
 */
export type BleScanFilter =
  | { readonly services: readonly string[]; readonly namePrefix?: string }
  | { readonly services?: undefined; readonly namePrefix: string };

export interface ScanOptions {
  readonly acceptAllDevices: boolean;
  readonly filters: readonly BleScanFilter[];
  readonly optionalServices: readonly string[];
}

export interface ManufacturerDataEntry {
  readonly companyId: number;
  readonly data: ReadOnlyBytes;
}

export interface ServiceDataEntry {
  readonly serviceUuid: string;
  readonly data: ReadOnlyBytes;
}

export interface AdvertisementFrame {
  readonly rssiDbm?: number;
  readonly txPowerDbm?: number;
  readonly manufacturerData: readonly ManufacturerDataEntry[];
  readonly serviceData: readonly ServiceDataEntry[];
}

export type NotificationListener = (data: ByteReader) => void;

export type DeviceSelection = "select" | "remembered";

export type { Unsubscribe } from "./sim/tick.js";

import type { Unsubscribe } from "./sim/tick.js";

export interface BleTransport {
  /** Human-readable device name for logs and the connect dialog. */
  readonly deviceName: () => string;
  /** Opaque device id (Web Bluetooth id or fixture meta.deviceId). */
  readonly deviceId: () => string;
  /**
   * Select a device (first call may show a picker) and connect its GATT server.
   * Repeated calls reconnect without a picker when the transport remembers the device.
   */
  readonly connect: (scan: ScanOptions, selection?: DeviceSelection) => Promise<GattProfile>;
  readonly read: (ref: CharacteristicRef) => Promise<DataView>;
  readonly write: (
    ref: CharacteristicRef,
    payload: ReadOnlyBytes,
    mode?: GattWriteMode,
  ) => Promise<void>;
  readonly subscribe: (
    ref: CharacteristicRef,
    listener: NotificationListener,
  ) => Promise<Unsubscribe>;
  /** Advertising frames for the current device; a no-op when unavailable. */
  readonly watchAdvertisements: (listener: (frame: AdvertisementFrame) => void) => Unsubscribe;
  /** Fires when the GATT connection drops unexpectedly. */
  readonly onDisconnected: (listener: () => void) => Unsubscribe;
  readonly disconnect: () => Promise<void>;
}
