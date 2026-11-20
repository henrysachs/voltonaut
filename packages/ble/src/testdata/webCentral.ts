// oxlint-disable typescript/prefer-readonly-parameter-types -- This boundary fake implements Web Bluetooth's external event and BufferSource contracts, including mutable DataView values.
import type {
  WebBluetoothAdvertisementEvent,
  WebBluetoothCharacteristic,
  WebBluetoothCharacteristicValueChangedEvent,
  WebBluetoothDevice,
} from "../webBluetoothTypes.js";
import { HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT } from "../uuids.js";

interface TestCentralOptions {
  readonly serviceUuid?: string;
  readonly characteristicUuid?: string;
  readonly startNotifications?: () => Promise<void>;
  readonly stopNotifications?: () => Promise<void>;
  readonly beforeConnect?: () => Promise<void>;
  readonly beforeRead?: () => Promise<void>;
}

const properties = {
  read: true,
  notify: true,
  write: true,
  indicate: true,
  writeWithoutResponse: true,
};

function createCharacteristic(options: TestCentralOptions) {
  const notifications = new Set<(event: WebBluetoothCharacteristicValueChangedEvent) => void>();
  const writes: BufferSource[] = [];
  let view = new DataView(Uint8Array.from([0, 64]).buffer);
  let stops = 0;

  const characteristic: WebBluetoothCharacteristic = {
    uuid: options.characteristicUuid ?? HEART_RATE_MEASUREMENT,
    properties,
    get value() {
      return view;
    },
    readValue: () => (options.beforeRead?.() ?? Promise.resolve()).then(() => view),
    writeValue: (bytes) => {
      writes.push(bytes);

      return Promise.resolve();
    },
    startNotifications: () => options.startNotifications?.() ?? Promise.resolve(),
    stopNotifications: () => {
      stops += 1;

      return options.stopNotifications?.() ?? Promise.resolve();
    },
    getDescriptors: () => Promise.resolve([{ uuid: "00002902-0000-1000-8000-00805f9b34fb" }]),
    addEventListener: (_type, listener) => {
      notifications.add(listener);
    },
    removeEventListener: (_type, listener) => {
      notifications.delete(listener);
    },
  };

  return {
    characteristic,
    writes: () => writes,
    stops: () => stops,
    notify(bytes: readonly number[] = [0, 64]) {
      view = new DataView(Uint8Array.from(bytes).buffer);

      for (const listener of notifications) {
        listener({ target: characteristic });
      }
    },
  };
}

type DeviceListener = (event: WebBluetoothAdvertisementEvent) => void;

function createDevice(characteristic: WebBluetoothCharacteristic, options: TestCentralOptions) {
  const events = new Map<string, Set<DeviceListener>>();
  let connects = 0;

  const service = {
    uuid: options.serviceUuid ?? HEART_RATE_SERVICE,
    getCharacteristic: () => Promise.resolve(characteristic),
    getCharacteristics: () => Promise.resolve([characteristic]),
  };

  const server = {
    connected: true,
    connect: () => {
      connects += 1;

      return (options.beforeConnect?.() ?? Promise.resolve()).then(() => server);
    },
    disconnect: () => {},
    getPrimaryServices: () => Promise.resolve([service]),
  };

  const device: WebBluetoothDevice = {
    id: "strap-1",
    name: "Test strap",
    gatt: server,
    addEventListener: (type: string, listener: DeviceListener) => {
      const listeners = events.get(type) ?? new Set<DeviceListener>();

      listeners.add(listener);
      events.set(type, listeners);
    },
    removeEventListener: (type: string, listener: DeviceListener) => {
      events.get(type)?.delete(listener);
    },
    watchAdvertisements: () => Promise.resolve(),
  };

  return {
    device,
    connects: () => connects,
    event(type: string, event: WebBluetoothAdvertisementEvent) {
      for (const listener of events.get(type) ?? []) {
        listener(event);
      }
    },
  };
}

export function createTestCentral(options: TestCentralOptions = {}) {
  const characteristic = createCharacteristic(options);
  const device = createDevice(characteristic.characteristic, options);
  const requests: string[] = [];

  return {
    ...characteristic,
    ...device,
    central: {
      requestDevice: (request: { readonly acceptAllDevices?: boolean }) => {
        requests.push(JSON.stringify(request));

        return Promise.resolve(device.device);
      },
    },
    requests: () => requests,
  };
}
