import {
  createFtmsLabControl,
  isFtmsControlPoint,
  type AdvertisementFrame,
  type BleTransport,
  type CharacteristicRef,
  type GattProfile,
  type LabControl,
  type LabControlOptions,
} from "@voltonaut/ble";
import { createSnifferSession, type SnifferSession } from "./session.js";

type DeviceState =
  | { readonly kind: "connecting" | "ready" | "disconnected" }
  | { readonly kind: "error"; readonly message: string };

export type LabChange = "selection" | "profile" | "state" | "capture";

export type LabTiming = Pick<LabControlOptions, "clock" | "ticker">;

export class LabDevice {
  readonly session: SnifferSession;
  state: DeviceState = { kind: "connecting" };
  profile: GattProfile = { services: [] };
  firmware = "";
  notes = "";
  advertisement: AdvertisementFrame | undefined;
  /** FTMS preset authority of the current GATT session; replaced only by a new connect. */
  ftms: LabControl | undefined;
  private queue = Promise.resolve();
  private readonly stopDisconnected: () => void;
  private stopAdvertisements = (): void => {};

  constructor(
    readonly number: number,
    readonly id: string,
    readonly name: string,
    transport: BleTransport,
    private readonly timing: LabTiming,
    private readonly changed: (change: LabChange, device: Readonly<LabDevice>) => void,
  ) {
    this.session = createSnifferSession(transport, () => {
      changed("capture", this);
    });
    this.stopDisconnected = transport.onDisconnected(() => {
      this.endControl("Verbindung getrennt. Neu verbinden.");
      this.state = { kind: "disconnected" };
      changed("state", this);
    });
  }

  private endControl(reason: string): void {
    this.ftms?.invalidate(reason);
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
    this.endControl("Neue Verbindung wird aufgebaut.");
    this.ftms = undefined;
    this.state = { kind: "connecting" };
    this.changed("state", this);
    this.profile = await this.session.transport.connect(scan, "remembered");
    this.ftms = createFtmsLabControl({
      transport: this.session.transport,
      profile: this.profile,
      ...this.timing,
    });
    this.state = { kind: "ready" };
    this.stopAdvertisements();
    this.stopAdvertisements = this.session.transport.watchAdvertisements((frame) => {
      this.advertisement = frame;
      this.changed("state", this);
    });
    this.changed("profile", this);
  };

  readonly disconnect = async (): Promise<void> => {
    this.endControl("Verbindung getrennt. Neu verbinden.");
    await this.session.transport.disconnect();
    this.state = { kind: "disconnected" };
    this.changed("state", this);
  };

  readonly dispose = async (): Promise<void> => {
    this.endControl("Labor geschlossen.");
    this.stopAdvertisements();
    this.stopDisconnected();
    await this.session.dispose();
  };

  readonly setMetadata = (firmware: string, notes: string): void => {
    this.firmware = firmware;
    this.notes = notes;
  };

  /** A raw control-point write's late reply could satisfy a later preset wait. */
  readonly rawWrite = (ref: CharacteristicRef): void => {
    if (isFtmsControlPoint(ref)) {
      this.endControl("Rohwrite auf FTMS Control Point. Für Presets neu verbinden.");
    }
  };
}
