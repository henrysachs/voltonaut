// oxlint-disable typescript/prefer-readonly-parameter-types -- Native GATT fake retains DataView/BufferSource contracts and characteristic listener identities.
import type {
  WebBluetoothCentral,
  WebBluetoothCharacteristic,
  WebBluetoothCharacteristicProperties,
  WebBluetoothCharacteristicValueChangedEvent,
  WebBluetoothDevice,
  WebBluetoothServer,
  WebBluetoothService,
} from "@voltonaut/ble";

function playUuid(part: string): string {
  return `0000000${part}-19ca-4651-86e5-fa29dcdd09d1`;
}

function sensorUuid(part: string): string {
  return `0000${part}-0000-1000-8000-00805f9b34fb`;
}

function unexpectedWrite(): never {
  document.body.dataset["unexpectedWrite"] = "true";
  throw new Error("unexpected BLE write");
}

function bufferBytes(bytes: BufferSource): Uint8Array {
  return bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function nativeCharacteristic(
  uuid: string,
  properties: WebBluetoothCharacteristicProperties,
  initial: readonly number[],
) {
  const listeners = new Set<(event: WebBluetoothCharacteristicValueChangedEvent) => void>();
  let value = new DataView(Uint8Array.from(initial).buffer);
  let writer: (bytes: readonly number[]) => void = unexpectedWrite;

  const characteristic: WebBluetoothCharacteristic = {
    uuid,
    properties,
    get value() {
      return value;
    },
    readValue: () => Promise.resolve(value),
    writeValue: unexpectedWrite,
    writeValueWithoutResponse: (bytes) => {
      writer([...bufferBytes(bytes)]);

      return Promise.resolve();
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

  return {
    characteristic,
    listenerCount: () => listeners.size,
    writeWith: (next: (bytes: readonly number[]) => void) => {
      writer = next;
    },
    notify: (bytes: readonly number[]) => {
      value = new DataView(Uint8Array.from(bytes).buffer);

      for (const listener of listeners) {
        listener({ target: characteristic });
      }
    },
  };
}

function nativeService(
  uuid: string,
  characteristics: readonly WebBluetoothCharacteristic[],
): WebBluetoothService {
  return {
    uuid,
    getCharacteristics: () => Promise.resolve(characteristics),
    getCharacteristic: (id) =>
      Promise.resolve(
        characteristics.find((item) => item.uuid === id) ??
          Promise.reject(new Error("missing characteristic")),
      ),
  };
}

function nativeDevice(
  id: string,
  service: WebBluetoothService,
  stop: () => void,
): WebBluetoothDevice {
  const disconnected = new Set<() => void>();

  const server: WebBluetoothServer = {
    connected: true,
    connect: () => Promise.resolve(server),
    getPrimaryServices: () => Promise.resolve([service]),
    disconnect: () => {
      const count = Number(document.body.getAttribute(`data-disconnect-${id}`));
      document.body.setAttribute(`data-disconnect-${id}`, String(count + 1));
      stop();

      for (const listener of disconnected) {
        listener();
      }
    },
  };

  document.addEventListener(`test-${id}-disconnect`, server.disconnect);

  return {
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
}

function fakeSensor(heartRate: boolean): WebBluetoothDevice {
  const bytes = heartRate ? [0, 132] : [0x45, 0, 180, 0, 244, 0];

  const sample = nativeCharacteristic(
    sensorUuid(heartRate ? "2a37" : "2ad2"),
    { notify: true },
    bytes,
  );

  const feature = nativeCharacteristic(
    sensorUuid("2acc"),
    { read: true },
    [0, 0, 0, 0, 8, 32, 0, 0],
  );

  const characteristics = heartRate
    ? [sample.characteristic]
    : [sample.characteristic, feature.characteristic];

  const service = nativeService(sensorUuid(heartRate ? "180d" : "1826"), characteristics);

  const timer = setInterval(sample.notify, 100, bytes);

  return nativeDevice(heartRate ? "hr" : "trainer", service, () => {
    clearInterval(timer);
  });
}

function playState(side: "left" | "right", held: boolean): readonly number[] {
  const bytes = [7, 8, 0, 16, 1, 24, 1, 32, 1, 40, 1, 48, 1, 56, 1, 64, 0, 72, 0];
  bytes[2] = side === "left" ? 1 : 0;
  bytes[12] = held ? 0 : 1;

  return bytes;
}

function playInputs(side: "left" | "right", measurement: ReturnType<typeof nativeCharacteristic>) {
  let held = false;
  let frames = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const notify = (): void => {
    measurement.notify(playState(side, held));
    frames += 1;
    document.body.dataset[`playFrames${side}`] = String(frames);
  };

  document.addEventListener(`test-play-${side}-down`, () => {
    held = true;
  });
  document.addEventListener(`test-play-${side}-up`, () => {
    held = false;
  });

  return {
    start: () => {
      notify();
      clearInterval(timer);
      timer = setInterval(notify, 50);
    },
    stop: () => {
      clearInterval(timer);
    },
  };
}

function fakePlay(side: "left" | "right"): WebBluetoothDevice {
  const measurement = nativeCharacteristic(playUuid("2"), { notify: true }, []);
  const response = nativeCharacteristic(playUuid("4"), { indicate: true, read: true }, []);
  const control = nativeCharacteristic(playUuid("3"), { writeWithoutResponse: true }, []);
  const inputs = playInputs(side, measurement);
  let writes = 0;
  control.writeWith((bytes) => {
    if (
      bytes.join(",") !== "82,105,100,101,79,110" ||
      measurement.listenerCount() !== 1 ||
      response.listenerCount() !== 1
    ) {
      unexpectedWrite();
    }

    writes += 1;
    document.body.dataset[`playWrites${side}`] = String(writes);
    response.notify(bytes);
    inputs.start();
  });

  return nativeDevice(
    `play-${side}`,
    nativeService(playUuid("1"), [
      measurement.characteristic,
      response.characteristic,
      control.characteristic,
    ]),
    inputs.stop,
  );
}

function installPlayBluetoothFake(): void {
  const left = fakePlay("left");
  const right = fakePlay("right");
  const trainer = fakeSensor(false);
  const hr = fakeSensor(true);
  let gesture = false;
  let choices = 0;
  document.addEventListener(
    "click",
    () => {
      gesture = true;
    },
    { capture: true },
  );
  document.addEventListener("click", () => {
    gesture = false;
  });

  const central: WebBluetoothCentral = {
    requestDevice: (options) => {
      if (!gesture || !navigator.userActivation.isActive) {
        return Promise.reject(new Error("picker must be synchronous in click"));
      }

      choices += 1;
      document.body.dataset["playPickerCalls"] = String(choices);
      const services = options.filters?.flatMap((filter) => filter.services) ?? [];

      if (services.includes(playUuid("1"))) {
        const label =
          document.body.dataset["playSelection"] ??
          document.activeElement?.closest("section")?.querySelector("h3")?.textContent ??
          "";

        const chosen = label.includes("links") ? left : right;

        return Promise.resolve(chosen);
      }

      return Promise.resolve(services.includes(sensorUuid("180d")) ? hr : trainer);
    },
  };

  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: central });
}

export function playBluetoothFakeScript(): string {
  return (
    [
      playUuid,
      sensorUuid,
      unexpectedWrite,
      bufferBytes,
      nativeCharacteristic,
      nativeService,
      nativeDevice,
      fakeSensor,
      playState,
      playInputs,
      fakePlay,
      installPlayBluetoothFake,
    ]
      .map((fn) => fn.toString())
      .join("\n") + "\ninstallPlayBluetoothFake();"
  );
}
