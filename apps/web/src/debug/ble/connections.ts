import {
  createNavigatorBluetoothCentral,
  createWebBluetoothTransport,
  type BleTransport,
} from "@voltonaut/ble";
import type { LabDevices } from "./devices.js";

export async function addNativeDevice(
  devices: Readonly<LabDevices>,
  scan: Parameters<BleTransport["connect"]>[0],
): Promise<void> {
  const central = createNavigatorBluetoothCentral();

  if (central === undefined) {
    throw new Error("Web Bluetooth benötigt Chrome/Edge und HTTPS oder localhost");
  }

  const selected = await central.requestDevice({
    acceptAllDevices: true,
    optionalServices: scan.optionalServices,
  });

  const existing = devices.findDevice(selected.id);

  if (existing !== undefined) {
    devices.select(existing);

    return;
  }

  const transport = createWebBluetoothTransport({
    central: { requestDevice: () => Promise.resolve(selected) },
  });

  const device = devices.add(transport, selected.id, selected.name ?? "Unbekanntes Gerät");

  device.run(() => device.connect(scan));
}
