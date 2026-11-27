// oxlint-disable typescript/prefer-readonly-parameter-types -- This boundary fake implements Web Bluetooth's external event and BufferSource contracts, including mutable DataView values.
/**
 * Native Web Bluetooth central serving scripted sim peripherals. Tests run the
 * same peripheral bytes once behind the sim transport and once behind the
 * Web Bluetooth transport, so both paths share one device-setup assertion.
 */

import { bytesToDataView, readOnlyBytes, type ReadOnlyBytes } from "../bytes.js";
import type { SimLink, SimPeripheral } from "../sim/transport.js";
import type { CharacteristicInfo, CharacteristicRef } from "../transport.js";
import type {
  WebBluetoothCentral,
  WebBluetoothCharacteristic,
  WebBluetoothCharacteristicValueChangedEvent,
  WebBluetoothDevice,
  WebBluetoothRequestOptions,
  WebBluetoothServer,
} from "../webBluetoothTypes.js";

type ValueListener = (event: WebBluetoothCharacteristicValueChangedEvent) => void;

function bufferBytes(value: BufferSource): ReadOnlyBytes {
  return readOnlyBytes(
    ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value),
  );
}

class NativeCharacteristic implements WebBluetoothCharacteristic {
  value: DataView | null = null;
  readonly uuid: string;
  readonly properties: WebBluetoothCharacteristic["properties"];
  private readonly listeners = new Set<ValueListener>();

  constructor(
    private readonly peripheral: SimPeripheral,
    private readonly ref: CharacteristicRef,
    info: CharacteristicInfo,
    private readonly link: SimLink,
  ) {
    const has = (property: CharacteristicInfo["properties"][number]): boolean =>
      info.properties.includes(property);

    this.uuid = info.uuid;
    this.properties = {
      read: has("read"),
      write: has("write"),
      writeWithoutResponse: has("writeWithoutResponse"),
      notify: has("notify"),
      indicate: has("indicate"),
    };
  }

  readonly readValue = (): Promise<DataView> => {
    const bytes = this.peripheral.read?.(this.ref);

    return bytes === undefined
      ? Promise.reject(new Error("unreadable"))
      : Promise.resolve(bytesToDataView(bytes));
  };

  readonly writeValue = (bytes: BufferSource): Promise<void> => {
    this.peripheral.write?.(this.ref, bufferBytes(bytes), this.link);

    return Promise.resolve();
  };

  readonly writeValueWithoutResponse = this.writeValue;
  readonly startNotifications = (): Promise<void> => Promise.resolve();
  readonly stopNotifications = (): Promise<void> => Promise.resolve();
  readonly getDescriptors = (): Promise<readonly []> => Promise.resolve([]);

  readonly addEventListener = (_type: "characteristicvaluechanged", listener: ValueListener) => {
    this.listeners.add(listener);
  };

  readonly removeEventListener = (_type: "characteristicvaluechanged", listener: ValueListener) => {
    this.listeners.delete(listener);
  };

  deliver(bytes: ReadOnlyBytes): void {
    this.value = bytesToDataView(bytes);

    for (const listener of this.listeners) listener({ target: this });
  }
}

function nativeServer(peripheral: SimPeripheral): WebBluetoothServer {
  const characteristics = new Map<string, NativeCharacteristic>();
  let stop: (() => void) | undefined;

  const link: SimLink = {
    notify: (ref, bytes) => {
      characteristics.get(`${ref.serviceUuid}/${ref.characteristicUuid}`)?.deliver(bytes);
    },
  };

  const services = peripheral.profile.services.map((service) => {
    const native = service.characteristics.map((info) => {
      const ref = { serviceUuid: service.uuid, characteristicUuid: info.uuid };
      const characteristic = new NativeCharacteristic(peripheral, ref, info, link);
      characteristics.set(`${service.uuid}/${info.uuid}`, characteristic);

      return characteristic;
    });

    return {
      uuid: service.uuid,
      getCharacteristic: (uuid: string): Promise<WebBluetoothCharacteristic> => {
        const found = native.find((characteristic) => characteristic.uuid === uuid);

        return found === undefined
          ? Promise.reject(new Error(`missing ${uuid}`))
          : Promise.resolve(found);
      },
      getCharacteristics: () => Promise.resolve(native),
    };
  });

  const server: WebBluetoothServer = {
    connected: true,
    connect: () => {
      stop?.();
      stop = peripheral.start(link);

      return Promise.resolve(server);
    },
    disconnect: () => {
      stop?.();
      stop = undefined;
    },
    getPrimaryServices: () => Promise.resolve(services),
  };

  return server;
}

function nativeDevice(peripheral: SimPeripheral): WebBluetoothDevice {
  return {
    id: peripheral.id,
    name: peripheral.name,
    gatt: nativeServer(peripheral),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function offers(peripheral: SimPeripheral, options: WebBluetoothRequestOptions): boolean {
  return (options.filters ?? []).some(
    (filter) =>
      (filter.services ?? []).every((uuid) =>
        peripheral.profile.services.some((service) => service.uuid === uuid),
      ) &&
      (filter.namePrefix === undefined || peripheral.name.startsWith(filter.namePrefix)),
  );
}

/** Picks the first peripheral whose services satisfy one request filter. */
export function createPeripheralCentral(
  peripherals: readonly SimPeripheral[],
): WebBluetoothCentral {
  const devices = peripherals.map((peripheral) => ({
    peripheral,
    device: nativeDevice(peripheral),
  }));

  return {
    requestDevice(options) {
      const found = devices.find(({ peripheral }) => offers(peripheral, options));

      return found === undefined
        ? Promise.reject(new Error("no device selected"))
        : Promise.resolve(found.device);
    },
  };
}
