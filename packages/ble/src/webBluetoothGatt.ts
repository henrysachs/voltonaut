// oxlint-disable typescript/prefer-readonly-parameter-types -- Native GATT contracts retain DataView-bearing characteristics and mutable service maps.
import { bytesCopy, byteReader, type ReadOnlyBytes } from "./bytes.js";
import {
  discoverProfile,
  resolveCharacteristic,
  type DeviceState,
} from "./webBluetoothDiscovery.js";
import type {
  BleScanFilter,
  CharacteristicRef,
  DeviceSelection,
  GattProfile,
  NotificationListener,
  ScanOptions,
} from "./transport.js";
import type {
  WebBluetoothCentral,
  WebBluetoothCharacteristic,
  WebBluetoothDevice,
  WebBluetoothRequestOptions,
} from "./webBluetoothTypes.js";

function toRequestOptions(scan: ScanOptions): WebBluetoothRequestOptions {
  if (scan.acceptAllDevices) {
    return { acceptAllDevices: true, optionalServices: scan.optionalServices };
  }

  const filters = scan.filters.map((filter: BleScanFilter) => ({
    services: filter.services,
    ...(filter.namePrefix !== undefined && { namePrefix: filter.namePrefix }),
  }));

  return { filters, optionalServices: scan.optionalServices };
}

function onCharacteristicValueChanged(
  listener: NotificationListener,
): (event: { readonly target: WebBluetoothCharacteristic }) => void {
  return (event) => {
    const value = event.target.value;

    if (value !== null && value !== undefined) {
      listener(byteReader(value));
    }
  };
}

function releaseQueue(): void {}

export class WebBluetoothGatt {
  private state: DeviceState = { device: undefined, server: undefined, services: new Map() };
  private session = new AbortController();
  private queue = Promise.resolve();
  private readonly subscriptions = new Set<() => void>();
  private removeDisconnectListener: (() => void) | undefined;

  constructor(
    private readonly central: WebBluetoothCentral,
    private readonly onDisconnected: () => void,
  ) {}

  get device(): WebBluetoothDevice | undefined {
    return this.state.device;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(releaseQueue, releaseQueue);

    return result;
  }

  private invalidate(): void {
    this.session.abort(new Error("device is not connected"));
    this.removeDisconnectListener?.();

    for (const stop of this.subscriptions) {
      stop();
    }

    this.state.server = undefined;
    this.state.services.clear();
  }

  private withSession<T>(
    operation: (current: DeviceState, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const current = this.state;
    const { signal } = this.session;

    return this.enqueue(async () => {
      signal.throwIfAborted();
      const result = await operation(current, signal);
      signal.throwIfAborted();

      return result;
    });
  }

  private rememberDevice(device: WebBluetoothDevice): void {
    this.state.device = device;
    const { signal } = this.session;

    const onDisconnected = (): void => {
      if (signal.aborted) {
        return;
      }

      this.invalidate();
      this.onDisconnected();
    };

    device.addEventListener("gattserverdisconnected", onDisconnected);
    this.removeDisconnectListener = () => {
      device.removeEventListener("gattserverdisconnected", onDisconnected);
    };
  }

  connect(scan: ScanOptions, selection: DeviceSelection = "remembered"): Promise<GattProfile> {
    const previous = this.state;
    this.invalidate();
    this.state = { device: previous.device, server: undefined, services: new Map() };
    this.session = new AbortController();
    const current = this.state;
    const { signal } = this.session;

    const selected =
      selection === "select" || current.device === undefined
        ? this.central.requestDevice(toRequestOptions(scan))
        : Promise.resolve(current.device);

    return selected.then((device: WebBluetoothDevice) =>
      this.enqueue(async () => {
        signal.throwIfAborted();

        if (previous.device !== device) {
          previous.device?.gatt?.disconnect();
        }

        this.rememberDevice(device);

        if (device.gatt === null) {
          throw new Error("device exposes no GATT server");
        }

        const server = await device.gatt.connect();
        signal.throwIfAborted();
        current.server = server;
        const profile = await discoverProfile(current, server, signal);
        signal.throwIfAborted();

        return profile;
      }),
    );
  }

  read(ref: CharacteristicRef): Promise<DataView> {
    return this.withSession(async (current, signal) => {
      const characteristic = await resolveCharacteristic(current, ref);
      signal.throwIfAborted();

      return characteristic.readValue();
    });
  }

  write(ref: CharacteristicRef, payload: ReadOnlyBytes): Promise<void> {
    return this.withSession(async (current, signal) => {
      const characteristic = await resolveCharacteristic(current, ref);
      signal.throwIfAborted();

      return characteristic.writeValue(bytesCopy(payload));
    });
  }

  subscribe(ref: CharacteristicRef, listener: NotificationListener): Promise<() => void> {
    return this.withSession(async (current, signal) => {
      const characteristic = await resolveCharacteristic(current, ref);
      signal.throwIfAborted();
      let active = true;

      const onValueChanged = onCharacteristicValueChanged((data) => {
        if (active && !signal.aborted) {
          listener(data);
        }
      });

      const stop = (): void => {
        if (!active) {
          return;
        }

        active = false;
        characteristic.removeEventListener("characteristicvaluechanged", onValueChanged);
        this.subscriptions.delete(stop);
        void this.enqueue(() => characteristic.stopNotifications());
      };

      this.subscriptions.add(stop);
      characteristic.addEventListener("characteristicvaluechanged", onValueChanged);

      try {
        await characteristic.startNotifications();
        signal.throwIfAborted();

        return stop;
      } catch (error) {
        stop();
        throw error;
      }
    });
  }

  disconnect(): Promise<void> {
    const current = this.state;
    this.invalidate();

    return this.enqueue(() => {
      current.device?.gatt?.disconnect();

      return Promise.resolve();
    });
  }
}
