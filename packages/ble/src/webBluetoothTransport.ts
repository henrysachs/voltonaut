/**
 * Web Bluetooth implementation of the BleTransport seam. Device selection goes
 * through navigator.bluetooth.requestDevice (a picker, needs a user gesture);
 * later connects reuse the remembered device via gatt.connect() so the
 * reconnect path needs no second picker.
 */

// oxlint-disable typescript/prefer-readonly-parameter-types -- the Web Bluetooth structural types mirror lib Map-valued events and DataView-bearing members; the rule cannot express their readonly-ness. T6 friction, see docs/open-questions.md.
import { readOnlyBytes, type ReadOnlyBytes } from "./bytes.js";
import { WebBluetoothGatt } from "./webBluetoothGatt.js";
import type {
  AdvertisementFrame,
  BleTransport,
  ManufacturerDataEntry,
  ServiceDataEntry,
} from "./transport.js";
import { normalizeUuid } from "./uuids.js";
import type {
  WebBluetoothAdvertisementEvent,
  WebBluetoothCentral,
  WebBluetoothDevice,
} from "./webBluetoothTypes.js";

export interface WebBluetoothTransportOptions {
  readonly central: WebBluetoothCentral;
}

interface AbortHolder {
  controller: AbortController | undefined;
}

interface ListenerList {
  listeners: (() => void)[];
}

function viewToReadOnlyBytes(view: DataView): ReadOnlyBytes {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

  return readOnlyBytes({ length: bytes.length, at: (index) => bytes.at(index) });
}

function toAdvertisementFrame(event: WebBluetoothAdvertisementEvent): AdvertisementFrame {
  const manufacturerData: ManufacturerDataEntry[] = [];

  for (const [companyId, view] of event.manufacturerData) {
    manufacturerData.push({ companyId, data: viewToReadOnlyBytes(view) });
  }

  const serviceData: ServiceDataEntry[] = [];

  for (const [serviceUuid, view] of event.serviceData) {
    const normalized = normalizeUuid(serviceUuid);

    if (normalized !== undefined) {
      serviceData.push({ serviceUuid: normalized, data: viewToReadOnlyBytes(view) });
    }
  }

  return {
    manufacturerData,
    serviceData,
    ...(event.rssi !== undefined && { rssiDbm: event.rssi }),
    ...(event.txPower !== undefined && { txPowerDbm: event.txPower }),
  };
}

interface AdvertisementRegistration {
  readonly handleEvent: (event: WebBluetoothAdvertisementEvent) => void;
}

function startDeviceAdvertisements(
  device: WebBluetoothDevice | undefined,
  registrations: readonly AdvertisementRegistration[],
  holder: AbortHolder,
): void {
  const controller = holder.controller ?? new AbortController();
  holder.controller = controller;

  for (const registration of registrations) {
    device?.addEventListener("advertisementreceived", registration.handleEvent);
  }

  void device?.watchAdvertisements?.({ signal: controller.signal }).catch(() => {});
}

function watchAdvertisementsMember(
  device: WebBluetoothDevice | undefined,
  registrations: AdvertisementRegistration[],
  holder: AbortHolder,
  listener: (frame: AdvertisementFrame) => void,
): () => void {
  const registration: AdvertisementRegistration = {
    handleEvent: (event) => {
      listener(toAdvertisementFrame(event));
    },
  };

  registrations.push(registration);
  startDeviceAdvertisements(device, registrations, holder);

  return () => {
    const remaining = registrations.filter((candidate) => candidate !== registration);

    registrations.length = 0;
    registrations.push(...remaining);
    device?.removeEventListener("advertisementreceived", registration.handleEvent);

    if (registrations.length === 0) {
      holder.controller?.abort();
      holder.controller = undefined;
    }
  };
}

function onDisconnectedMember(disconnected: ListenerList, listener: () => void): () => void {
  disconnected.listeners.push(listener);

  return () => {
    const remaining = disconnected.listeners.filter((candidate) => candidate !== listener);

    disconnected.listeners.length = 0;
    disconnected.listeners.push(...remaining);
  };
}

export function createWebBluetoothTransport(options: WebBluetoothTransportOptions): BleTransport {
  const disconnected: ListenerList = { listeners: [] };
  const registrations: AdvertisementRegistration[] = [];
  const abortHolder: AbortHolder = { controller: undefined };

  const gatt = new WebBluetoothGatt(options.central, () => {
    for (const listener of disconnected.listeners.slice()) {
      listener();
    }
  });

  return {
    deviceName: () => gatt.device?.name ?? "unknown device",
    deviceId: () => gatt.device?.id ?? "unknown",
    connect: (scan, selection) => gatt.connect(scan, selection),
    read: (ref) => gatt.read(ref),
    write: (ref, payload) => gatt.write(ref, payload),
    subscribe: (ref, listener) => gatt.subscribe(ref, listener),
    watchAdvertisements: (listener) =>
      watchAdvertisementsMember(gatt.device, registrations, abortHolder, listener),
    onDisconnected: (listener) => onDisconnectedMember(disconnected, listener),
    disconnect: () => gatt.disconnect(),
  };
}
