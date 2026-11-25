import type { StatusPublisher } from "../adapterShell.js";
import type { EventBus } from "@voltonaut/shared";
import type { ByteReader } from "../bytes.js";
import type { SimClock, TickSource, Unsubscribe } from "../sim/index.js";
import type {
  BleTransport,
  CharacteristicRef,
  DeviceSelection,
  GattProfile,
} from "../transport.js";
import {
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_COMMAND_RESPONSE,
} from "../uuids.js";
import { RIDE_ON } from "./handshake.js";
import { parsePlayInput, type PlayInput, type PlaySide } from "./parse.js";

export interface PlaySessionOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly transport: BleTransport;
  readonly side: PlaySide;
}

const SCAN = {
  acceptAllDevices: false,
  filters: [{ services: [ZWIFT_PLAY_LEGACY_SERVICE] }],
  optionalServices: [],
};

function ref(characteristicUuid: string): CharacteristicRef {
  return { serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE, characteristicUuid };
}

function supports(profile: GattProfile): boolean {
  const service = profile.services.find((item) => item.uuid === ZWIFT_PLAY_LEGACY_SERVICE);

  return [
    { uuid: ZWIFT_PLAY_MEASUREMENT, property: "notify" },
    { uuid: ZWIFT_PLAY_COMMAND_RESPONSE, property: "indicate" },
    { uuid: ZWIFT_PLAY_CONTROL_POINT, property: "writeWithoutResponse" },
  ].every(
    (required: Readonly<{ uuid: string; property: string }>) =>
      service?.characteristics.some(
        (item) =>
          item.uuid === required.uuid &&
          item.properties.some((property) => property === required.property),
      ) === true,
  );
}

interface Completion {
  readonly resolve: () => void;
  readonly reject: (error: Readonly<Error>) => void;
}

export class PlaySession {
  private active = true;
  private message = "Seite noch unbekannt. Verbindung wird aufgebaut.";
  private readonly stops: Unsubscribe[] = [];
  private completion: Completion | undefined;
  private written = false;
  private writeCompleted = false;
  private plain = false;
  private held = false;
  private source = "";
  private latest: PlayInput | undefined;

  constructor(
    private readonly options: PlaySessionOptions,
    private readonly publish: StatusPublisher,
  ) {}

  description(): string {
    return this.message;
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error("Play session stopped");
    }
  }

  private emit(pressed: boolean): void {
    this.held = pressed;
    this.options.bus.publish({
      type: "controller.button",
      tS: this.options.clock.nowS(),
      button: this.options.side === "right" ? "shiftUp" : "shiftDown",
      source: this.source,
      pressed,
    });
  }

  stop(): void {
    this.active = false;

    for (const stop of this.stops.splice(0)) {
      stop();
    }

    if (this.held) {
      this.emit(false);
    }

    this.completion?.reject(new Error("Play session stopped"));
    this.completion = undefined;
  }

  private fail(message: string): void {
    this.message = message;
    this.stop();
    this.publish("error");
  }

  private applyInput(): void {
    const input = this.latest;

    if (!this.active || !this.plain || !this.writeCompleted || input === undefined) {
      return;
    }

    if (input.side !== this.options.side) {
      this.fail(
        `Falscher Griff: ${input.side === "left" ? "links" : "rechts"} erkannt. Im passenden Play-Slot verbinden oder „Gerät wählen“ nutzen.`,
      );

      return;
    }

    this.source = `play:${this.options.transport.deviceId()}:${input.side}`;
    this.message = `${input.side === "left" ? "Linker" : "Rechter"} Griff bestätigt. Seitentaste schaltet ${input.side === "left" ? "runter" : "hoch"}.`;
    this.completion?.resolve();
    this.completion = undefined;

    if (input.buttons.shift !== this.held) {
      this.emit(input.buttons.shift);
    }
  }

  private input(data: ByteReader): void {
    if (!this.active) {
      return;
    }

    const parsed = parsePlayInput(data);

    if (parsed.ok) {
      this.latest = parsed.value;
      this.applyInput();
    }
  }

  private response(data: ByteReader): void {
    if (!this.active || !this.written) {
      return;
    }

    if (
      data.byteLength !== RIDE_ON.length ||
      Array.from({ length: RIDE_ON.length }, (_value, index) => data.getUint8(index)).some(
        (byte, index) => byte !== RIDE_ON.at(index),
      )
    ) {
      this.fail(
        "Nicht unterstützte/verschlüsselte Play-Antwort. Keine weiteren Writes; BLE-Labor verwenden.",
      );

      return;
    }

    if (this.plain) {
      return;
    }

    this.plain = true;
    this.message = "RideOn bestätigt, Seite noch unbekannt. Eine Taste am gewählten Griff drücken.";
    this.publish("handshaking");
    this.applyInput();
  }

  private async observe(uuid: string, receive: (data: ByteReader) => void): Promise<void> {
    const stop = await this.options.transport.subscribe(ref(uuid), receive);

    if (!this.active) {
      stop();
      this.assertActive();
    }

    this.stops.push(stop);
  }

  private async handshake(): Promise<void> {
    const deadlineS = this.options.clock.nowS() + 3;

    const ready = new Promise<void>((resolve, reject) => {
      this.completion = { resolve, reject };
    });

    this.stops.push(
      this.options.ticker.start(() => {
        if (!this.plain && this.options.clock.nowS() >= deadlineS) {
          this.fail("Keine RideOn-Antwort. Griff aufwecken und erneut verbinden.");
        }
      }),
    );
    this.written = true;

    await Promise.all([
      ready,
      this.options.transport
        .write(ref(ZWIFT_PLAY_CONTROL_POINT), RIDE_ON, "withoutResponse")
        .then(() => {
          this.writeCompleted = true;
          this.applyInput();

          return true;
        }),
    ]);
  }

  async start(selection: DeviceSelection): Promise<void> {
    try {
      const profile = await this.options.transport.connect(SCAN, selection);
      this.assertActive();

      if (!supports(profile)) {
        throw new Error(
          "Kein unterstützter Play-Griff mit Notify/Indicate/writeWithoutResponse. Anderes Gerät wählen.",
        );
      }

      this.publish("handshaking");
      await this.observe(ZWIFT_PLAY_MEASUREMENT, (data) => {
        this.input(data);
      });
      await this.observe(ZWIFT_PLAY_COMMAND_RESPONSE, (data) => {
        this.response(data);
      });
      this.assertActive();
      await this.handshake();
      this.assertActive();
    } catch (error) {
      if (this.active) {
        this.message = error instanceof Error ? error.message : "Play-Verbindung fehlgeschlagen.";
      }

      this.stop();
      throw error;
    }
  }
}
