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
  binding: AdvertisementBinding | undefined;
}

interface AdvertisementBinding {
  readonly device: WebBluetoothDevice;
  readonly controller: AbortController;
  readonly receive: (event: WebBluetoothAdvertisementEvent) => void;
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
  readonly listener: (frame: AdvertisementFrame) => void;
}

function stopDeviceAdvertisements(holder: AbortHolder): void {
  const binding = holder.binding;
  holder.binding = undefined;
  binding?.controller.abort();
  binding?.device.removeEventListener("advertisementreceived", binding.receive);
}

function startDeviceAdvertisements(
  device: WebBluetoothDevice | undefined,
  registrations: readonly AdvertisementRegistration[],
  holder: AbortHolder,
): void {
  if (device === undefined || registrations.length === 0 || holder.binding?.device === device) {
    return;
  }

  stopDeviceAdvertisements(holder);
  const controller = new AbortController();

  const receive = (event: WebBluetoothAdvertisementEvent): void => {
    if (!controller.signal.aborted) {
      for (const registration of registrations.slice()) {
        registration.listener(toAdvertisementFrame(event));
      }
    }
  };

  holder.binding = { device, controller, receive };
  device.addEventListener("advertisementreceived", receive);

  void device.watchAdvertisements?.({ signal: controller.signal }).catch(() => {});
}

function watchAdvertisementsMember(
  device: WebBluetoothDevice | undefined,
  registrations: AdvertisementRegistration[],
  holder: AbortHolder,
  listener: (frame: AdvertisementFrame) => void,
): () => void {
  const registration: AdvertisementRegistration = { listener };

  registrations.push(registration);
  startDeviceAdvertisements(device, registrations, holder);

  return () => {
    const remaining = registrations.filter((candidate) => candidate !== registration);

    registrations.length = 0;
    registrations.push(...remaining);

    if (registrations.length === 0) {
      stopDeviceAdvertisements(holder);
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
  const abortHolder: AbortHolder = { binding: undefined };

  const gatt = new WebBluetoothGatt(
    options.central,
    () => {
      for (const listener of disconnected.listeners.slice()) {
        listener();
      }
    },
    () => {
      stopDeviceAdvertisements(abortHolder);
    },
  );

  return {
    deviceName: () => gatt.rememberedDevice?.name ?? "unknown device",
    deviceId: () => gatt.rememberedDevice?.id ?? "unknown",
    connect: async (scan, selection) => {
      const profile = await gatt.connect(scan, selection);
      startDeviceAdvertisements(gatt.device, registrations, abortHolder);

      return profile;
    },
    read: (ref) => gatt.read(ref),
    write: (ref, payload, mode) => gatt.write(ref, payload, mode),
    subscribe: (ref, listener) => gatt.subscribe(ref, listener),
    watchAdvertisements: (listener) =>
      watchAdvertisementsMember(gatt.device, registrations, abortHolder, listener),
    onDisconnected: (listener) => onDisconnectedMember(disconnected, listener),
    disconnect: () => gatt.disconnect(),
  };
}
