import type { AdvertisementFrame, BleTransport, GattProfile } from "@voltonaut/ble";
import { createSnifferSession, type SnifferSession } from "./session.js";

type DeviceState =
  | { readonly kind: "connecting" | "ready" | "disconnected" }
  | { readonly kind: "error"; readonly message: string };

export type LabChange = "selection" | "profile" | "state" | "capture";

export class LabDevice {
  readonly session: SnifferSession;
  state: DeviceState = { kind: "connecting" };
  profile: GattProfile = { services: [] };
  firmware = "";
  notes = "";
  advertisement: AdvertisementFrame | undefined;
  control: "unrequested" | "granted" = "unrequested";
  private queue = Promise.resolve();
  private readonly stopDisconnected: () => void;
  private stopAdvertisements = (): void => {};

  constructor(
    readonly number: number,
    readonly id: string,
    readonly name: string,
    transport: BleTransport,
    private readonly changed: (change: LabChange, device: Readonly<LabDevice>) => void,
  ) {
    this.session = createSnifferSession(transport, () => {
      changed("capture", this);
    });
    this.stopDisconnected = transport.onDisconnected(() => {
      this.control = "unrequested";
      this.state = { kind: "disconnected" };
      changed("state", this);
    });
  }

  readonly run = (operation: () => Promise<void>): void => {
    this.queue = this.queue.then(() => this.execute(operation));
  };

  private async execute(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bluetooth operation failed";
      this.state = { kind: "error", message };
      this.session.marker(`error: ${message}`);
      this.changed("state", this);
    }
  }

  readonly connect = async (scan: Parameters<BleTransport["connect"]>[0]): Promise<void> => {
    this.state = { kind: "connecting" };
    this.control = "unrequested";
    this.changed("state", this);
    this.profile = await this.session.transport.connect(scan, "remembered");
    this.state = { kind: "ready" };
    this.stopAdvertisements();
    this.stopAdvertisements = this.session.transport.watchAdvertisements((frame) => {
      this.advertisement = frame;
      this.changed("state", this);
    });
    this.changed("profile", this);
  };

  readonly disconnect = async (): Promise<void> => {
    await this.session.transport.disconnect();
    this.control = "unrequested";
    this.state = { kind: "disconnected" };
    this.changed("state", this);
  };

  readonly dispose = async (): Promise<void> => {
    this.stopAdvertisements();
    this.stopDisconnected();
    await this.session.dispose();
  };

  readonly setMetadata = (firmware: string, notes: string): void => {
    this.firmware = firmware;
    this.notes = notes;
  };

  readonly grantControl = (): void => {
    this.control = "granted";
  };
}
