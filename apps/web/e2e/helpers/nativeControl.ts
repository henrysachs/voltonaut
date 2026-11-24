// oxlint-disable typescript/prefer-readonly-parameter-types -- Native GATT boundary fake preserves BufferSource/DataView and listener identities.
import type {
  WebBluetoothCentral,
  WebBluetoothCharacteristic,
  WebBluetoothCharacteristicProperties,
  WebBluetoothCharacteristicValueChangedEvent,
  WebBluetoothDevice,
  WebBluetoothServer,
} from "@voltonaut/ble";

function uuid(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

function playUuid(short: string): string {
  return `0000000${short}-19ca-4651-86e5-fa29dcdd09d1`;
}

function rejectWrite(): never {
  document.body.dataset["controlUnexpectedWrite"] = "true";
  throw new Error("unexpected control write or mode");
}

function bufferBytes(source: BufferSource): readonly number[] {
  return [
    ...(source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength)),
  ];
}

function nativeCharacteristic(
  id: string,
  properties: WebBluetoothCharacteristicProperties,
  initial: readonly number[],
) {
  let value = new DataView(Uint8Array.from(initial).buffer);
  const listeners = new Set<(event: WebBluetoothCharacteristicValueChangedEvent) => void>();
  let writer: (bytes: readonly number[]) => void = rejectWrite;

  const write = (source: BufferSource): Promise<void> => {
    writer(bufferBytes(source));

    return Promise.resolve();
  };

  const characteristic: WebBluetoothCharacteristic = {
    uuid: id,
    properties,
    get value() {
      return value;
    },
    readValue: () => Promise.resolve(value),
    writeValue: properties.write === true ? write : rejectWrite,
    writeValueWithoutResponse: properties.writeWithoutResponse === true ? write : rejectWrite,
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
    count: () => listeners.size,
    writer: (next: (bytes: readonly number[]) => void) => {
      writer = next;
    },
    notify(bytes: readonly number[]) {
      value = new DataView(Uint8Array.from(bytes).buffer);

      for (const listener of listeners) listener({ target: characteristic });
    },
  };
}

function nativeDevice(
  id: string,
  serviceUuid: string,
  characteristics: readonly WebBluetoothCharacteristic[],
  lifecycle: Readonly<{ connect: () => void; disconnect: () => void }>,
): WebBluetoothDevice {
  const disconnected = new Set<() => void>();

  const server: WebBluetoothServer = {
    connected: true,
    connect: () => {
      lifecycle.connect();

      return Promise.resolve(server);
    },
    disconnect: () => {
      lifecycle.disconnect();

      for (const listener of disconnected) listener();
    },
    getPrimaryServices: () =>
      Promise.resolve([
        {
          uuid: serviceUuid,
          getCharacteristics: () => Promise.resolve(characteristics),
          getCharacteristic: (target) => {
            const found = characteristics.find((characteristic) => characteristic.uuid === target);

            return found === undefined
              ? Promise.reject(new Error("missing characteristic"))
              : Promise.resolve(found);
          },
        },
      ]),
  };

  document.addEventListener(`test-control-${id}-disconnect`, server.disconnect);

  return {
    id,
    name: id,
    gatt: server,
    addEventListener: (type, listener) => {
      if (type === "gattserverdisconnected") disconnected.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "gattserverdisconnected") disconnected.delete(listener);
    },
  };
}

function trainerWriter(control: ReturnType<typeof nativeCharacteristic>) {
  const writes: {
    readonly opcode: number;
    readonly gradePct: number | null;
    readonly atMs: number;
  }[] = [];

  let phase: "unowned" | "owned" | "started" = "unowned";

  return (bytes: readonly number[]): void => {
    const opcode = bytes[0] ?? -1;

    if (control.count() !== 1) rejectWrite();

    if (opcode === 0 && bytes.length === 1) phase = "owned";
    else if (opcode === 7 && bytes.length === 1 && phase === "owned") phase = "started";
    else if (opcode === 8 && bytes[1] === 1 && phase === "started") phase = "owned";
    else if (opcode !== 0x11 || bytes.length !== 7 || phase !== "started") rejectWrite();
    const view = new DataView(Uint8Array.from(bytes).buffer);
    const gradePct = opcode === 0x11 ? view.getInt16(3, true) / 100 : null;
    writes.push({ opcode, gradePct, atMs: performance.now() });
    document.body.dataset["controlWrites"] = JSON.stringify(writes);
    document.body.dataset["controlOpcodes"] = writes.map((write) => write.opcode).join(",");
    document.body.dataset["controlCount"] = String(writes.length);

    if (gradePct !== null) document.body.dataset["controlGrade"] = String(gradePct);

    if (document.body.dataset["controlDropAck"] !== "true") control.notify([0x80, opcode, 1]);
  };
}

function trainer(): WebBluetoothDevice {
  const sample = nativeCharacteristic(uuid("2ad2"), { notify: true }, []);
  const feature = nativeCharacteristic(uuid("2acc"), { read: true }, [0, 0, 0, 0, 0, 32, 0, 0]);
  const control = nativeCharacteristic(uuid("2ad9"), { write: true, indicate: true }, []);
  const status = nativeCharacteristic(uuid("2ada"), { notify: true }, []);
  control.writer(trainerWriter(control));
  document.addEventListener("test-control-permission-lost", () => {
    status.notify([0xff]);
  });

  let timer: ReturnType<typeof setInterval> | undefined;

  const notify = (): void => {
    const rpm = document.body.dataset["controlCadence"] === "zero" ? 0 : 180;
    sample.notify([0x45, 0, rpm, 0, 244, 0]);
  };

  return nativeDevice(
    "trainer",
    uuid("1826"),
    [sample.characteristic, feature.characteristic, control.characteristic, status.characteristic],
    {
      connect: () => {
        clearInterval(timer);
        timer = setInterval(notify, 100);
      },
      disconnect: () => {
        clearInterval(timer);
      },
    },
  );
}

function playState(side: "left" | "right", held: boolean): readonly number[] {
  const bytes = [7, 8, 0, 16, 1, 24, 1, 32, 1, 40, 1, 48, 1, 56, 1, 64, 0, 72, 0];
  bytes[2] = side === "left" ? 1 : 0;
  bytes[12] = held ? 0 : 1;

  return bytes;
}

function play(side: "left" | "right"): WebBluetoothDevice {
  const sample = nativeCharacteristic(playUuid("2"), { notify: true }, []);
  const response = nativeCharacteristic(playUuid("4"), { indicate: true }, []);
  const control = nativeCharacteristic(playUuid("3"), { writeWithoutResponse: true }, []);
  let held = false;
  let frames = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  document.addEventListener(`test-control-${side}-down`, () => {
    held = true;
  });
  document.addEventListener(`test-control-${side}-up`, () => {
    held = false;
  });
  control.writer((bytes) => {
    if (
      bytes.join(",") !== "82,105,100,101,79,110" ||
      sample.count() !== 1 ||
      response.count() !== 1
    )
      rejectWrite();
    document.body.dataset[`controlPlay${side}`] = "RideOn";
    response.notify(bytes);
    timer = setInterval(() => {
      sample.notify(playState(side, held));
      frames += 1;
      document.body.dataset[`controlFrames${side}`] = String(frames);
    }, 50);
  });

  return nativeDevice(
    side,
    playUuid("1"),
    [sample.characteristic, response.characteristic, control.characteristic],
    {
      connect: () => {
        clearInterval(timer);
      },
      disconnect: () => {
        clearInterval(timer);
      },
    },
  );
}

function install(): void {
  const sensors = { trainer: trainer(), left: play("left"), right: play("right") };

  const central: WebBluetoothCentral = {
    requestDevice: (options) => {
      if (!navigator.userActivation.isActive) return Promise.reject(new Error("gesture required"));

      const isPlay =
        options.filters?.some((filter) => filter.services.includes(playUuid("1"))) === true;

      const label =
        document.activeElement?.closest("section")?.querySelector("h3")?.textContent ?? "";

      return Promise.resolve(
        isPlay
          ? label.includes("links") || label.includes("Linker")
            ? sensors.left
            : sensors.right
          : sensors.trainer,
      );
    },
  };

  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: central });
}

export function nativeControlFakeScript(): string {
  return (
    [
      uuid,
      playUuid,
      rejectWrite,
      bufferBytes,
      nativeCharacteristic,
      nativeDevice,
      trainerWriter,
      trainer,
      playState,
      play,
      install,
    ]
      .map((fn) => fn.toString())
      .join("\n") + "\ninstall();"
  );
}
