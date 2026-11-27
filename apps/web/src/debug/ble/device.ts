import {
  byteReader,
  createFtmsLabControl,
  decodeDeviceText,
  isFtmsControlPoint,
  labDeviceKind,
  labReadableCharacteristics,
  labRecordedCharacteristics,
  FIRMWARE_REVISION,
  type AdvertisementFrame,
  type BleTransport,
  type CharacteristicRef,
  type GattProfile,
  type LabControl,
  type LabControlOptions,
  type LabDeviceKind,
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

  get kind(): LabDeviceKind {
    return labDeviceKind(this.profile);
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

  private note(action: string, ref: CharacteristicRef): (error: Readonly<Error>) => void {
    return (error) => {
      this.session.note(`${action} ${ref.characteristicUuid} fehlgeschlagen: ${error.message}`);
    };
  }

  /**
   * Records every notify/indicate channel from connect on and reads every standard
   * readable characteristic once (Device Information, features, ranges). Subscribing
   * writes only the CCCD; no command reaches the device. The transport serializes GATT
   * operations per device. A failing channel is noted in the capture as a lab event,
   * not as a user marker, and does not stop the others.
   */
  private async recordEverything(): Promise<void> {
    await Promise.all(
      labRecordedCharacteristics(this.profile).map((ref) =>
        this.session.observe(ref).catch(this.note("Aufzeichnung", ref)),
      ),
    );
    await this.readAll();
  }

  private async readEach(refs: readonly CharacteristicRef[]): Promise<void> {
    await Promise.all(
      refs.map((ref) =>
        this.session.transport
          .read(ref)
          .then(byteReader)
          .then(
            (value) => {
              if (ref.characteristicUuid === FIRMWARE_REVISION && this.firmware === "") {
                this.firmware = decodeDeviceText(value);
                this.changed("profile", this);
              }

              return true;
            },
            this.note("Lesen", ref),
          ),
      ),
    );
  }

  /** Reads every standard readable characteristic once; the proprietary Zwift ones stay manual. */
  readonly readAll = (): Promise<void> => this.readEach(labReadableCharacteristics(this.profile));

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
    // Background: a slow CCCD write must not hold markers or exports of this device.
    void this.recordEverything().then(() => {
      this.changed("profile", this);

      return true;
    });
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
