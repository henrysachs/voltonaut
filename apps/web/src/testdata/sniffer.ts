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

/** One characteristic with its own value and listeners, like a native GATT characteristic. */
function listenedCharacteristic(
  template: Omit<WebBluetoothCharacteristic, "value" | "addEventListener" | "removeEventListener">,
  initial: readonly number[],
) {
  const listeners = new Set<(event: WebBluetoothCharacteristicValueChangedEvent) => void>();
  let value = new DataView(Uint8Array.from(initial).buffer);

  const characteristic: WebBluetoothCharacteristic = {
    ...template,
    get value() {
      return value;
    },
    readValue: () => Promise.resolve(value),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };

  const emit = (bytes?: readonly number[]): void => {
    if (bytes !== undefined) value = new DataView(Uint8Array.from(bytes).buffer);

    for (const listener of listeners) {
      listener({ target: characteristic });
    }
  };

  return { characteristic, emit };
}

function notificationCharacteristic(notificationsReady: Readonly<Promise<void>>) {
  const writes: number[][] = [];

  const common = {
    readValue: () => Promise.resolve(new DataView(new ArrayBuffer(0))),
    writeValue: () => Promise.resolve(),
    startNotifications: () => notificationsReady,
    stopNotifications: () => Promise.resolve(),
    getDescriptors: () => Promise.resolve([]),
  };

  const data = listenedCharacteristic(
    { ...common, uuid: INDOOR_BIKE_DATA, properties: { notify: true } },
    [0x45, 0, 180, 0, 244, 0],
  );

  const indication = { emit: (_bytes: readonly number[]): void => {} };

  const control = listenedCharacteristic(
    {
      ...common,
      uuid: FITNESS_MACHINE_CONTROL_POINT,
      properties: { write: true, indicate: true },
      writeValue: (bytes) => {
        const payload = payloadBytes(bytes);

        writes.push(payload);
        indication.emit([0x80, payload[0] ?? 0, 1]);

        return Promise.resolve();
      },
    },
    [],
  );

  indication.emit = control.emit;

  return {
    data: data.characteristic,
    control: control.characteristic,
    emit: () => {
      data.emit();
    },
    writes,
  };
}

/** Reads stay pending until the test settles all of them (the lab also reads once at connect). */
function readCharacteristic(template: WebBluetoothCharacteristic) {
  const pending: { readonly finish: () => void; readonly fail: () => void }[] = [];

  const feature: WebBluetoothCharacteristic = {
    ...template,
    uuid: FITNESS_MACHINE_FEATURE,
    properties: { read: true },
    readValue: () =>
      new Promise<DataView>((resolve, reject) => {
        pending.push({
          finish: () => {
            resolve(new DataView(new ArrayBuffer(8)));
          },
          fail: () => {
            reject(new Error("read failed"));
          },
        });
      }),
  };

  return {
    feature,
    finishRead: () => {
      for (const read of pending.splice(0)) read.finish();
    },
    failRead: () => {
      for (const read of pending.splice(0)) read.fail();
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
