import type {
  WebBluetoothCentral,
  WebBluetoothCharacteristic,
  WebBluetoothCharacteristicValueChangedEvent,
  WebBluetoothDevice,
  WebBluetoothServer,
  WebBluetoothService,
} from "@voltonaut/ble";

// oxlint-disable typescript/prefer-readonly-parameter-types -- Native GATT fake retains DataView-bearing characteristic references for notification callbacks.
function uuid(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
}

function characteristic(short: string, bytes: readonly number[]): WebBluetoothCharacteristic {
  const listeners = new Set<(event: WebBluetoothCharacteristicValueChangedEvent) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const view = new DataView(Uint8Array.from(bytes).buffer);

  const result: WebBluetoothCharacteristic = {
    uuid: uuid(short),
    properties: { read: short === "2acc", notify: short !== "2acc" },
    value: view,
    readValue: () => Promise.resolve(view),
    writeValue: () => {
      document.body.dataset["bleWrite"] = "unexpected";

      return Promise.reject(new Error("ride must be read only"));
    },
    startNotifications: async () => {
      await delay();
      timer = setInterval(() => {
        for (const listener of listeners) {
          listener({ target: result });
        }
      }, 200);
    },
    stopNotifications: () => {
      clearInterval(timer);

      return Promise.resolve();
    },
    getDescriptors: () => Promise.resolve([]),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };

  return result;
}

function service(heartRate: boolean): WebBluetoothService {
  const data = heartRate
    ? characteristic("2a37", [0, 132])
    : characteristic("2ad2", [0x45, 0, 180, 0, 244, 0]);

  const characteristics = heartRate
    ? [data]
    : [data, characteristic("2acc", [0, 0, 0, 0, 8, 32, 0, 0])];

  return {
    uuid: uuid(heartRate ? "180d" : "1826"),
    getCharacteristics: () => Promise.resolve(characteristics),
    getCharacteristic: (id) => {
      const found = characteristics.find((candidate) => candidate.uuid === id);

      return found === undefined
        ? Promise.reject(new Error("missing characteristic"))
        : Promise.resolve(found);
    },
  };
}

function device(heartRate: boolean): WebBluetoothDevice {
  const disconnects = new Set<() => void>();
  const dataService = service(heartRate);

  const server: WebBluetoothServer = {
    connected: true,
    connect: () => Promise.resolve(server),
    disconnect: () => {
      for (const listener of disconnects) {
        listener();
      }
    },
    getPrimaryServices: () => Promise.resolve([dataService]),
  };

  if (!heartRate) {
    document.addEventListener("test-ble-disconnect", () => {
      server.disconnect();
    });
  }

  return {
    id: heartRate ? "test-hr" : "test-trainer",
    name: heartRate ? "Test HR" : "Test trainer",
    gatt: server,
    addEventListener: (type, listener) => {
      if (type === "gattserverdisconnected") {
        disconnects.add(listener);
      }
    },
    removeEventListener: () => {},
  };
}

function installBluetoothFake(): void {
  let trainerSelections = 0;
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
    requestDevice: (options) => {
      const heartRate =
        options.filters?.some((filter) => (filter.services ?? []).includes(uuid("180d"))) ?? false;

      if (!heartRate) {
        trainerSelections += 1;
        document.body.dataset["trainerSelections"] = String(trainerSelections);

        if (!pickerGesture || !navigator.userActivation.isActive) {
          return Promise.reject(new Error("picker requires user activation"));
        }

        if (trainerSelections === 1) {
          return Promise.reject(new DOMException("picker cancelled", "NotFoundError"));
        }

        if (trainerSelections === 2) {
          return Promise.reject(new DOMException("radio unavailable", "NetworkError"));
        }

        if (trainerSelections === 3) {
          return Promise.resolve(device(true));
        }
      }

      return Promise.resolve(device(heartRate));
    },
  };

  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: central });
}

/** Functions serialized together so the browser fake needs no application hooks. */
export function bluetoothFakeScript(): string {
  return (
    [uuid, delay, characteristic, service, device, installBluetoothFake]
      .map((fn) => fn.toString())
      .join("\n") + "\ninstallBluetoothFake();"
  );
}
