import type { BleTransport } from "@voltonaut/ble";
import { LabDevice, type LabChange, type LabTiming } from "./device.js";

export class LabDevices {
  private readonly devices: LabDevice[] = [];
  private selection: Readonly<LabDevice> | undefined;

  constructor(
    private readonly timing: LabTiming,
    private readonly changed: (change: LabChange, device: Readonly<LabDevice>) => void,
  ) {}

  get entries(): readonly Readonly<LabDevice>[] {
    return this.devices;
  }

  get selected(): Readonly<LabDevice> | undefined {
    return this.selection;
  }

  readonly select = (device: Readonly<LabDevice>): void => {
    this.selection = device;
    this.changed("selection", device);
  };

  readonly add = (transport: BleTransport, id: string, name: string): Readonly<LabDevice> => {
    const device = new LabDevice(
      this.devices.length + 1,
      id,
      name,
      transport,
      this.timing,
      this.changed,
    );

    this.devices.push(device);
    this.select(device);

    return device;
  };

  readonly findDevice = (id: string): Readonly<LabDevice> | undefined =>
    this.devices.find((device: Readonly<LabDevice>) => device.id === id);
}
