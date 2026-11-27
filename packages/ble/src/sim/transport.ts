/**
 * BleTransport over a scripted in-memory GATT peripheral. The production
 * adapters (shell, parsers, feature check, control procedures) run unchanged
 * on top; only the peripheral behind the seam is simulated.
 */

import { bytesToDataView, type ReadOnlyBytes } from "../bytes.js";
import type {
  BleTransport,
  CharacteristicInfo,
  CharacteristicRef,
  GattProfile,
  GattWriteMode,
  NotificationListener,
  ScanOptions,
} from "../transport.js";
import type { Unsubscribe } from "./tick.js";

/** The peripheral's side of an open connection. */
export interface SimLink {
  /** Delivers a notification or indication to current subscribers. */
  readonly notify: (ref: CharacteristicRef, bytes: ReadOnlyBytes) => void;
}

export interface SimPeripheral {
  readonly name: string;
  readonly id: string;
  readonly profile: GattProfile;
  /** Value of a readable characteristic; absent or undefined fails the read. */
  readonly read?: (ref: CharacteristicRef) => ReadOnlyBytes | undefined;
  /** Handles an accepted write; responses go through the link. */
  readonly write?: (ref: CharacteristicRef, payload: ReadOnlyBytes, link: SimLink) => void;
  /** Starts scripted notifications for one connection; the result stops them. */
  readonly start: (link: SimLink) => Unsubscribe;
}

export interface SimTransport extends BleTransport {
  /** Unexpected link loss, as a GATT server disconnect would report it. */
  readonly drop: () => void;
}

function key(ref: CharacteristicRef): string {
  return `${ref.serviceUuid}/${ref.characteristicUuid}`;
}

function matches(peripheral: SimPeripheral, scan: ScanOptions): boolean {
  const offered = new Set(peripheral.profile.services.map((service) => service.uuid));

  return (
    scan.acceptAllDevices ||
    scan.filters.some(
      (filter) =>
        (filter.services ?? []).every((uuid) => offered.has(uuid)) &&
        (filter.namePrefix === undefined || peripheral.name.startsWith(filter.namePrefix)),
    )
  );
}

function writable(characteristic: CharacteristicInfo, mode: GattWriteMode | undefined): boolean {
  const { properties } = characteristic;

  if (mode === "withResponse") return properties.includes("write");

  if (mode === "withoutResponse") return properties.includes("writeWithoutResponse");

  return properties.includes("write") || properties.includes("writeWithoutResponse");
}

class ScriptedTransport implements SimTransport {
  private stopScript: Unsubscribe | undefined;
  private readonly listeners = new Map<string, Set<NotificationListener>>();
  private readonly disconnects = new Set<() => void>();

  private readonly link: SimLink = {
    notify: (ref, bytes) => {
      for (const listener of this.listeners.get(key(ref)) ?? []) {
        listener(bytesToDataView(bytes));
      }
    },
  };

  constructor(private readonly peripheral: SimPeripheral) {}

  deviceName(): string {
    return this.peripheral.name;
  }

  deviceId(): string {
    return this.peripheral.id;
  }

  connect(scan: ScanOptions): Promise<GattProfile> {
    this.close();

    if (!matches(this.peripheral, scan)) {
      return Promise.reject(new Error("no sim device matches the scan filter"));
    }

    this.stopScript = this.peripheral.start(this.link);

    return Promise.resolve(this.peripheral.profile);
  }

  private characteristic(ref: CharacteristicRef): CharacteristicInfo {
    if (this.stopScript === undefined) throw new Error("device is not connected");

    const found = this.peripheral.profile.services
      .find((service) => service.uuid === ref.serviceUuid)
      ?.characteristics.find((characteristic) => characteristic.uuid === ref.characteristicUuid);

    if (found === undefined) throw new Error(`characteristic ${ref.characteristicUuid} missing`);

    return found;
  }

  async read(ref: CharacteristicRef): Promise<DataView> {
    await Promise.resolve();

    const value = this.characteristic(ref).properties.includes("read")
      ? this.peripheral.read?.(ref)
      : undefined;

    if (value === undefined) throw new Error(`characteristic ${ref.characteristicUuid} unreadable`);

    return bytesToDataView(value);
  }

  async write(ref: CharacteristicRef, payload: ReadOnlyBytes, mode?: GattWriteMode): Promise<void> {
    await Promise.resolve();

    if (!writable(this.characteristic(ref), mode)) {
      throw new Error(`characteristic ${ref.characteristicUuid} rejects this write`);
    }

    this.peripheral.write?.(ref, payload, this.link);
  }

  async subscribe(ref: CharacteristicRef, listener: NotificationListener): Promise<Unsubscribe> {
    await Promise.resolve();
    const { properties } = this.characteristic(ref);

    if (!properties.includes("notify") && !properties.includes("indicate")) {
      throw new Error(`characteristic ${ref.characteristicUuid} has no notifications`);
    }

    const recipients = this.listeners.get(key(ref)) ?? new Set<NotificationListener>();
    this.listeners.set(key(ref), recipients);
    recipients.add(listener);

    return () => {
      recipients.delete(listener);
    };
  }

  watchAdvertisements(): Unsubscribe {
    return () => {};
  }

  onDisconnected(listener: () => void): Unsubscribe {
    this.disconnects.add(listener);

    return () => {
      this.disconnects.delete(listener);
    };
  }

  private close(): void {
    this.stopScript?.();
    this.stopScript = undefined;
    this.listeners.clear();
  }

  disconnect(): Promise<void> {
    this.close();

    return Promise.resolve();
  }

  drop(): void {
    if (this.stopScript === undefined) return;

    this.close();

    for (const listener of this.disconnects) listener();
  }
}

export function createSimTransport(peripheral: SimPeripheral): SimTransport {
  return new ScriptedTransport(peripheral);
}
