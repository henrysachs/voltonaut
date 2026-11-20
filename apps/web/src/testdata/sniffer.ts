import {
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_CONTROL_POINT,
  INDOOR_BIKE_DATA,
  type WebBluetoothCharacteristic,
  type WebBluetoothCharacteristicValueChangedEvent,
  type WebBluetoothDevice,
  type WebBluetoothServer,
  type WebBluetoothAdvertisementEvent,
} from "@voltonaut/ble";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Native GATT fake retains DataView-bearing callbacks and characteristic references for notification delivery.
function payloadBytes(bytes: BufferSource): number[] {
  return Array.from(
    ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes),
  );
}

function notificationCharacteristic(notificationsReady: Readonly<Promise<void>>) {
  const listeners = new Set<(event: WebBluetoothCharacteristicValueChangedEvent) => void>();
  const writes: number[][] = [];
  let value = new DataView(Uint8Array.from([0x45, 0, 180, 0, 244, 0]).buffer);

  const data: WebBluetoothCharacteristic = {
    uuid: INDOOR_BIKE_DATA,
    properties: { notify: true },
    get value() {
      return value;
    },
    readValue: () => Promise.resolve(value),
    writeValue: () => Promise.resolve(),
    startNotifications: () => notificationsReady,
    stopNotifications: () => Promise.resolve(),
    getDescriptors: () => Promise.resolve([]),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };

  const emit = (): void => {
    for (const listener of listeners) {
      listener({ target: data });
    }
  };

  const control: WebBluetoothCharacteristic = {
    ...data,
    uuid: FITNESS_MACHINE_CONTROL_POINT,
    properties: { write: true, indicate: true },
    writeValue: (bytes) => {
      const payload = payloadBytes(bytes);

      writes.push(payload);
      value = new DataView(Uint8Array.from([0x80, payload[0] ?? 0, 1]).buffer);
      emit();

      return Promise.resolve();
    },
  };

  return { data, control, emit, writes };
}

function readCharacteristic(template: WebBluetoothCharacteristic) {
  let finish: (() => void) | undefined;
  let fail: (() => void) | undefined;

  const feature: WebBluetoothCharacteristic = {
    ...template,
    uuid: FITNESS_MACHINE_FEATURE,
    properties: { read: true },
    readValue: () =>
      new Promise<DataView>((resolve, reject) => {
        finish = () => {
          resolve(new DataView(new ArrayBuffer(8)));
        };

        fail = () => {
          reject(new Error("read failed"));
        };
      }),
  };

  return {
    feature,
    finishRead: () => {
      finish?.();
    },
    failRead: () => {
      fail?.();
    },
  };
}

function nativeDevice(id: string, characteristics: readonly WebBluetoothCharacteristic[]) {
  const disconnected = new Set<(event: WebBluetoothAdvertisementEvent) => void>();
  let disconnects = 0;

  const server: WebBluetoothServer = {
    connected: true,
    connect: () => Promise.resolve(server),
    disconnect: () => {
      disconnects += 1;

      for (const listener of disconnected) {
        listener({ manufacturerData: new Map(), serviceData: new Map() });
      }
    },
    getPrimaryServices: () =>
      Promise.resolve([
        {
          uuid: FITNESS_MACHINE_SERVICE,
          getCharacteristics: () => Promise.resolve(characteristics),
          getCharacteristic: (uuid) => {
            const found = characteristics.find((candidate) => candidate.uuid === uuid);

            return found === undefined
              ? Promise.reject(new Error("missing"))
              : Promise.resolve(found);
          },
        },
      ]),
  };

  const device: WebBluetoothDevice = {
    id,
    name: id,
    gatt: server,
    addEventListener: (type, listener) => {
      if (type === "gattserverdisconnected") {
        disconnected.add(listener);
      }
    },
    removeEventListener: (type, listener) => {
      if (type === "gattserverdisconnected") {
        disconnected.delete(listener);
      }
    },
  };

  return { device, disconnects: () => disconnects };
}

export function snifferDevice(
  id: string,
  notificationsReady: Readonly<Promise<void>> = Promise.resolve(),
) {
  const notifications = notificationCharacteristic(notificationsReady);
  const read = readCharacteristic(notifications.data);

  return {
    ...notifications,
    ...read,
    ...nativeDevice(id, [read.feature, notifications.data, notifications.control]),
  };
}
