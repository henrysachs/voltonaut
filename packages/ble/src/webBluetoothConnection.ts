// oxlint-disable typescript/prefer-readonly-parameter-types -- Native device and advertisement contracts retain DataView-bearing SDK members.
import type { GattServices } from "./webBluetoothDiscovery.js";
import type { WebBluetoothCentral, WebBluetoothDevice } from "./webBluetoothTypes.js";

export interface OwnedConnection {
  readonly kind: "owned";
  readonly device: WebBluetoothDevice;
  readonly services: GattServices;
  readonly signal: AbortSignal;
  readonly detach: () => void;
  readonly close: () => void;
}

export type GattConnection = { readonly kind: "unowned" } | OwnedConnection;

const deviceOwners = new WeakMap<WebBluetoothCentral, Set<string>>();

function reserveDevice(central: WebBluetoothCentral, deviceId: string): () => void {
  const devices = deviceOwners.get(central) ?? new Set<string>();
  deviceOwners.set(central, devices);

  if (devices.has(deviceId)) {
    throw new Error(
      "Gerät bereits in einer anderen Verbindung. Dort trennen oder anderes Gerät wählen.",
    );
  }

  devices.add(deviceId);

  return () => {
    devices.delete(deviceId);
  };
}

export function ownConnection(
  central: WebBluetoothCentral,
  device: WebBluetoothDevice,
  signal: AbortSignal,
  disconnected: () => void,
): OwnedConnection {
  const release = reserveDevice(central, device.id);
  let phase: "owned" | "dropped" | "closed" = "owned";

  const onDisconnected = (): void => {
    if (!signal.aborted && phase !== "closed") {
      phase = "dropped";
      disconnected();
    }
  };

  const detach = (): void => {
    device.removeEventListener("gattserverdisconnected", onDisconnected);
  };

  device.addEventListener("gattserverdisconnected", onDisconnected);

  return {
    kind: "owned",
    device,
    signal,
    services: { services: new Map() },
    detach,
    close() {
      if (phase === "closed") {
        return;
      }

      const previous = phase;
      phase = "closed";
      detach();

      try {
        if (previous === "owned") {
          device.gatt?.disconnect();
        }
      } finally {
        release();
      }
    },
  };
}
