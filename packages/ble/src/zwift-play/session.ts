import type { StatusPublisher } from "../adapterShell.js";
import type { EventBus } from "@voltonaut/shared";
import type { ByteReader } from "../bytes.js";
import type { SimClock, TickSource, Unsubscribe } from "../sim/index.js";
import type { BleTransport, CharacteristicRef, DeviceSelection } from "../transport.js";
import {
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_COMMAND_RESPONSE,
} from "../uuids.js";
import { isClickV2LockNotice } from "./clickV2.js";
import {
  CONTROLLER_SCAN,
  acceptsHandshakeReply,
  zwiftControllerLink,
  type ZwiftControllerLink,
} from "./controller.js";
import {
  SIDE_TEXT,
  controllerFrame,
  controllerName,
  shiftHint,
  type ControllerFrame,
  type ShiftButton,
} from "./frames.js";
import type { PlaySide } from "./parse.js";

export interface PlaySessionOptions {
  readonly bus: EventBus;
  readonly clock: SimClock;
  readonly ticker: TickSource;
  readonly transport: BleTransport;
  readonly side: PlaySide;
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
  private link: ZwiftControllerLink | undefined;
  private written = false;
  private writeCompleted = false;
  private plain = false;
  private confirmed = false;
  private readonly held = new Set<ShiftButton>();
  private source = "";
  private latest: ControllerFrame | undefined;

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

  private emit(button: ShiftButton, pressed: boolean): void {
    if (pressed) this.held.add(button);
    else this.held.delete(button);

    this.options.bus.publish({
      type: "controller.button",
      tS: this.options.clock.nowS(),
      button,
      source: this.source,
      pressed,
    });
  }

  stop(): void {
    this.active = false;

    for (const stop of this.stops.splice(0)) {
      stop();
    }

    for (const button of Array.from(this.held)) {
      this.emit(button, false);
    }

    this.completion?.reject(new Error("Play session stopped"));
    this.completion = undefined;
  }

  private fail(message: string): void {
    this.message = message;
    this.stop();
    this.publish("error");
  }

  private ref(characteristicUuid: string): CharacteristicRef {
    return {
      serviceUuid: this.link?.serviceUuid ?? ZWIFT_PLAY_LEGACY_SERVICE,
      characteristicUuid,
    };
  }

  private confirm(side: PlaySide): void {
    const family = this.link?.family ?? "play";

    this.source = `${family}:${this.options.transport.deviceId()}:${side}`;
    this.message = `${side === "left" ? "Linker" : "Rechter"} ${controllerName(family)} bestätigt. ${shiftHint(family, side)}`;
    this.confirmed = true;
    this.completion?.resolve();
    this.completion = undefined;
  }

  private applyInput(): void {
    const frame = this.latest;

    if (!this.active || !this.plain || !this.writeCompleted || frame === undefined) {
      return;
    }

    if (frame.side !== undefined && frame.side !== this.options.side) {
      this.fail(
        `Falscher ${controllerName(this.link?.family ?? "play")}: ${SIDE_TEXT[frame.side]} erkannt. Im passenden Slot verbinden oder „Gerät wählen“ nutzen.`,
      );

      return;
    }

    if (!this.confirmed) {
      if (frame.side === undefined) return;

      this.confirm(frame.side);
    }

    for (const button of ["shiftUp", "shiftDown"] satisfies readonly ShiftButton[]) {
      if (frame.held.has(button) !== this.held.has(button)) {
        this.emit(button, frame.held.has(button));
      }
    }
  }

  private input(data: ByteReader): void {
    if (!this.active) {
      return;
    }

    if (this.link?.family === "clickV2" && isClickV2LockNotice(data)) {
      this.message =
        "Click v2 meldet Sperre: Puck einmal in der Zwift-App verbinden, dann Zwift schließen. Alternativ nur den rechten Puck nutzen (+ hoch, B runter).";
      this.publish(this.confirmed ? "ready" : "handshaking");

      return;
    }

    const frame = controllerFrame(this.link?.family ?? "play", data);

    if (frame !== undefined) {
      this.latest = frame;
      this.applyInput();
    }
  }

  private response(data: ByteReader): void {
    if (!this.active || !this.written) {
      return;
    }

    if (this.link === undefined || !acceptsHandshakeReply(this.link, data)) {
      // UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2 – later Click v2 replies on …04 stay raw.
      if (this.plain && this.link?.family === "clickV2") return;

      this.fail(
        "Nicht unterstützte/verschlüsselte Controller-Antwort. Keine weiteren Writes; BLE-Labor verwenden.",
      );

      return;
    }

    if (this.plain) {
      return;
    }

    this.plain = true;
    this.message =
      "RideOn bestätigt, Seite noch unbekannt. Eine Taste am gewählten Controller drücken.";
    this.publish("handshaking");
    this.applyInput();
  }

  private async observe(uuid: string, receive: (data: ByteReader) => void): Promise<void> {
    const stop = await this.options.transport.subscribe(this.ref(uuid), receive);

    if (!this.active) {
      stop();
      this.assertActive();
    }

    this.stops.push(stop);
  }

  private async handshake(link: ZwiftControllerLink): Promise<void> {
    const deadlineS = this.options.clock.nowS() + 3;

    const ready = new Promise<void>((resolve, reject) => {
      this.completion = { resolve, reject };
    });

    this.stops.push(
      this.options.ticker.start(() => {
        if (!this.plain && this.options.clock.nowS() >= deadlineS) {
          this.fail("Keine RideOn-Antwort. Controller aufwecken und erneut verbinden.");
        }
      }),
    );
    this.written = true;

    await Promise.all([
      ready,
      this.options.transport
        .write(this.ref(ZWIFT_PLAY_CONTROL_POINT), link.handshake, "withoutResponse")
        .then(() => {
          this.writeCompleted = true;
          this.applyInput();

          return true;
        }),
    ]);
  }

  async start(selection: DeviceSelection): Promise<void> {
    try {
      const profile = await this.options.transport.connect(CONTROLLER_SCAN, selection);
      this.assertActive();
      const link = zwiftControllerLink(profile);

      if (!link.ok) {
        throw new Error(link.failure.reason);
      }

      this.link = link.value;
      this.publish("handshaking");
      await this.observe(ZWIFT_PLAY_MEASUREMENT, (data) => {
        this.input(data);
      });
      await this.observe(ZWIFT_PLAY_COMMAND_RESPONSE, (data) => {
        this.response(data);
      });
      this.assertActive();
      await this.handshake(link.value);
      this.assertActive();
    } catch (error) {
      if (this.active) {
        this.message =
          error instanceof Error ? error.message : "Controller-Verbindung fehlgeschlagen.";
      }

      this.stop();
      throw error;
    }
  }
}
