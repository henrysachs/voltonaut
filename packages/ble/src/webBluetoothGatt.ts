// oxlint-disable typescript/prefer-readonly-parameter-types -- Native GATT contracts retain DataView-bearing characteristics and mutable service maps.
import { bytesCopy, byteReader, type ReadOnlyBytes } from "./bytes.js";
import {
  discoverProfile,
  resolveCharacteristic,
  type GattServices,
} from "./webBluetoothDiscovery.js";
import {
  ownConnection,
  type GattConnection,
  type OwnedConnection,
} from "./webBluetoothConnection.js";
import type {
  BleScanFilter,
  CharacteristicRef,
  DeviceSelection,
  GattProfile,
  GattWriteMode,
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
    ...(filter.services !== undefined && { services: filter.services }),
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
  private connection: GattConnection = { kind: "unowned" };
  private selectedDevice: WebBluetoothDevice | undefined;
  private session = new AbortController();
  private queue = Promise.resolve();
  private readonly subscriptions = new Set<() => void>();

  constructor(
    private readonly central: WebBluetoothCentral,
    private readonly onDisconnected: () => void,
    private readonly onInvalidated: () => void,
  ) {}

  get device(): WebBluetoothDevice | undefined {
    return this.connection.kind === "owned" ? this.connection.device : undefined;
  }

  get rememberedDevice(): WebBluetoothDevice | undefined {
    return this.selectedDevice;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(releaseQueue, releaseQueue);

    return result;
  }

  private invalidate(): OwnedConnection | undefined {
    const previous = this.connection;
    this.connection = { kind: "unowned" };
    this.session.abort(new Error("device is not connected"));

    if (previous.kind === "owned") {
      previous.detach();
      previous.services.services.clear();
      this.onInvalidated();
    }

    for (const stop of this.subscriptions) {
      stop();
    }

    return previous.kind === "owned" ? previous : undefined;
  }

  private retire(connection: OwnedConnection | undefined): Promise<void> {
    return this.enqueue(() => {
      connection?.close();

      return Promise.resolve();
    });
  }

  private withSession<T>(
    operation: (current: GattServices, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const current = this.connection;

    if (current.kind === "unowned") {
      return Promise.reject(new Error("device is not connected"));
    }

    const { signal } = current;

    return this.enqueue(async () => {
      signal.throwIfAborted();
      const result = await operation(current.services, signal);
      signal.throwIfAborted();

      return result;
    });
  }

  connect(scan: ScanOptions, selection: DeviceSelection = "remembered"): Promise<GattProfile> {
    const retired = this.retire(this.invalidate());
    this.session = new AbortController();
    const { signal } = this.session;

    const selected =
      selection === "select" || this.selectedDevice === undefined
        ? this.central.requestDevice(toRequestOptions(scan))
        : Promise.resolve(this.selectedDevice);

    return this.connectSelected(selected, retired, signal);
  }

  private async connectSelected(
    selected: Promise<WebBluetoothDevice>,
    retired: Promise<void>,
    signal: AbortSignal,
  ): Promise<GattProfile> {
    try {
      const [device] = await Promise.all([selected, retired]);

      return await this.enqueue(() => this.open(device, signal));
    } catch (error) {
      if (this.session.signal === signal) {
        await this.retire(this.invalidate());
      }

      throw error;
    }
  }

  private async open(device: WebBluetoothDevice, signal: AbortSignal): Promise<GattProfile> {
    signal.throwIfAborted();
    this.selectedDevice = device;

    const connection = ownConnection(this.central, device, signal, () => {
      void this.retire(this.invalidate());
      this.onDisconnected();
    });

    this.connection = connection;

    if (device.gatt === null) {
      throw new Error("device exposes no GATT server");
    }

    const server = await device.gatt.connect();
    signal.throwIfAborted();
    const profile = await discoverProfile(connection.services, server, signal);
    signal.throwIfAborted();

    return profile;
  }

  read(ref: CharacteristicRef): Promise<DataView> {
    return this.withSession(async (current, signal) => {
      const characteristic = await resolveCharacteristic(current, ref);
      signal.throwIfAborted();

      return characteristic.readValue();
    });
  }

  write(ref: CharacteristicRef, payload: ReadOnlyBytes, mode?: GattWriteMode): Promise<void> {
    return this.withSession(async (current, signal) => {
      const characteristic = await resolveCharacteristic(current, ref);
      signal.throwIfAborted();

      const withoutResponse =
        mode === "withoutResponse" ||
        (mode === undefined &&
          characteristic.properties.write !== true &&
          characteristic.properties.writeWithoutResponse === true);

      if (withoutResponse) {
        if (
          characteristic.properties.writeWithoutResponse !== true ||
          characteristic.writeValueWithoutResponse === undefined
        ) {
          throw new Error("writeWithoutResponse is unavailable");
        }

        return characteristic.writeValueWithoutResponse(bytesCopy(payload));
      }

      if (mode === "withResponse" && characteristic.properties.write !== true) {
        throw new Error("write with response is unavailable");
      }

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
    return this.retire(this.invalidate());
  }
}
