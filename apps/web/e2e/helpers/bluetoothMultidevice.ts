import type {
  WebBluetoothCentral,
  WebBluetoothCharacteristic,
  WebBluetoothDevice,
  WebBluetoothServer,
  WebBluetoothService,
} from "@voltonaut/ble";

function multideviceValue(id: string): DataView {
  const bytes = id === "trainer" ? [0x45, 0, 180, 0, 244, 0] : [7, 8, id === "left" ? 1 : 0, 48, 1];

  return new DataView(Uint8Array.from(bytes).buffer);
}

function multideviceRead(id: string): Promise<DataView> {
  return new Promise((resolve, reject) => {
    document.addEventListener(
      `multi-read-${id}`,
      () => {
        resolve(multideviceValue(id));
      },
      { once: true },
    );
    document.addEventListener(
      `multi-fail-${id}`,
      () => {
        reject(new Error(`read failed ${id}`));
      },
      { once: true },
    );
  });
}

function multideviceCharacteristic(id: string): WebBluetoothCharacteristic {
  const listeners = new Set<Parameters<WebBluetoothCharacteristic["addEventListener"]>[1]>();

  const value = multideviceValue(id);

  const characteristic: WebBluetoothCharacteristic = {
    uuid:
      id === "trainer"
        ? "00002ad2-0000-1000-8000-00805f9b34fb"
        : "00000002-19ca-4651-86e5-fa29dcdd09d1",
    properties: { read: true, notify: true, write: true },
    value,
    readValue: () => multideviceRead(id),
    writeValue: () => {
      document.body.dataset["unexpectedWrite"] = id;

      return Promise.reject(new Error("No automatic writes allowed"));
    },
    startNotifications: () => Promise.resolve(),
    stopNotifications: () => Promise.resolve(),
    getDescriptors: () => Promise.resolve([]),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };

  document.addEventListener(`multi-notify-${id}`, () => {
    for (const listener of listeners) {
      listener({ target: characteristic });
    }
  });

  return characteristic;
}

function multideviceService(id: string): WebBluetoothService {
  const characteristic = multideviceCharacteristic(id);

  return {
    uuid:
      id === "trainer"
        ? "00001826-0000-1000-8000-00805f9b34fb"
        : "00000001-19ca-4651-86e5-fa29dcdd09d1",
    getCharacteristics: () => Promise.resolve([characteristic]),
    getCharacteristic: () => Promise.resolve(characteristic),
  };
}

function multideviceServer(id: string, onDisconnected: () => void): WebBluetoothServer {
  const service = multideviceService(id);
  let connects = 0;
  let disconnects = 0;
  let connected = false;

  const server: WebBluetoothServer = {
    get connected() {
      return connected;
    },
    connect: async () => {
      connects += 1;
      document.body.dataset[`${id}Connects`] = String(connects);

      if (document.body.dataset["delayConnect"] === id) {
        await new Promise<void>((resolve) => {
          document.addEventListener(
            `multi-connect-${id}`,
            () => {
              resolve();
            },
            { once: true },
          );
        });
      }

      connected = true;

      return server;
    },
    disconnect: () => {
      connected = false;
      disconnects += 1;
      document.body.dataset[`${id}Disconnects`] = String(disconnects);

      onDisconnected();
    },
    getPrimaryServices: () => Promise.resolve([service]),
  };

  return server;
}

function multideviceNative(id: string): WebBluetoothDevice {
  const disconnected = new Set<() => void>();

  const server = multideviceServer(id, () => {
    for (const listener of disconnected) {
      listener();
    }
  });

  return {
    id,
    name: id === "trainer" ? "Test trainer" : "Zwift Play",
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
}

function installMultideviceBluetooth(): void {
  const devices = [
    multideviceNative("trainer"),
    multideviceNative("left"),
    multideviceNative("right"),
  ];

  let selections = 0;
  let pickerGesture = false;
  document.addEventListener(
    "click",
    () => {
      pickerGesture = true;
    },
    { capture: true },
  );
  document.addEventListener("click", () => {
    pickerGesture = false;
  });

  const central: WebBluetoothCentral = {
    requestDevice: () => {
      if (!pickerGesture || !navigator.userActivation.isActive) {
        return Promise.reject(new Error("picker requires synchronous click"));
      }

      const selected = devices[selections] ?? devices[1];
      selections += 1;
      document.body.dataset["multiSelections"] = String(selections);

      return selected === undefined
        ? Promise.reject(new Error("Missing synthetic device"))
        : Promise.resolve(selected);
    },
  };

  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: central });
}

export function multideviceBluetoothScript(): string {
  return (
    [
      multideviceValue,
      multideviceRead,
      multideviceCharacteristic,
      multideviceService,
      multideviceServer,
      multideviceNative,
      installMultideviceBluetooth,
    ]
      .map((fn) => fn.toString())
      .join("\n") + "\ninstallMultideviceBluetooth();"
  );
}
