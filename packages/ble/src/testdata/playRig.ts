import { createEventBus, type DeviceEvent, type EventBus } from "@voltonaut/shared";
import { bytesToDataView, parseHex, toHex } from "../bytes.js";
import { createManualClock, createManualTicker } from "../sim/index.js";
import type { BleTransport, GattProfile, NotificationListener } from "../transport.js";
import {
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_COMMAND_RESPONSE,
} from "../uuids.js";
import { createPlayAdapter } from "../zwift-play/adapter.js";
import type { PlaySide } from "../zwift-play/parse.js";

export const RIDE_ON = "52 69 64 65 4f 6e";
export const RIGHT_RELEASED = "07 08 00 10 01 18 01 20 01 28 01 30 01 38 01 40 00 48 00";
export const RIGHT_PRESSED = RIGHT_RELEASED.replace("30 01", "30 00");
export const LEFT_PRESSED = RIGHT_PRESSED.replace("08 00", "08 01");

const PROFILE: GattProfile = {
  services: [
    {
      uuid: ZWIFT_PLAY_LEGACY_SERVICE,
      characteristics: [
        { uuid: ZWIFT_PLAY_MEASUREMENT, properties: ["notify"], descriptors: [] },
        { uuid: ZWIFT_PLAY_CONTROL_POINT, properties: ["writeWithoutResponse"], descriptors: [] },
        { uuid: ZWIFT_PLAY_COMMAND_RESPONSE, properties: ["indicate", "read"], descriptors: [] },
      ],
    },
  ],
};

function view(hex: string) {
  const bytes = parseHex(hex);

  if (bytes === undefined) {
    throw new Error("bad test data");
  }

  return bytesToDataView(bytes);
}

export interface RigOptions {
  readonly side?: PlaySide;
  readonly bus?: EventBus;
  readonly beforeSubscribe?: () => Promise<void>;
  readonly beforeConnect?: () => Promise<void>;
  readonly write?: () => Promise<void>;
  readonly profile?: GattProfile;
}

export function noop(): void {}

class PlayTestTransport implements BleTransport {
  readonly operations: string[] = [];
  readonly selections: string[] = [];
  private readonly listeners = new Map<string, Set<NotificationListener>>();
  private readonly historical: NotificationListener[] = [];
  private disconnected = noop;
  private id = "approved-device";

  constructor(private readonly options: RigOptions) {}

  deviceId(): string {
    return this.id;
  }
  deviceName(): string {
    return "Zwift Play";
  }
  setId(id: string): void {
    this.id = id;
  }

  async connect(
    _scan: Parameters<BleTransport["connect"]>[0],
    selection?: Parameters<BleTransport["connect"]>[1],
  ): Promise<GattProfile> {
    this.selections.push(selection ?? "remembered");
    await this.options.beforeConnect?.();

    return this.options.profile ?? PROFILE;
  }

  read(): Promise<DataView> {
    return Promise.reject(new Error("no reads expected"));
  }

  write(
    ref: Parameters<BleTransport["write"]>[0],
    bytes: Parameters<BleTransport["write"]>[1],
  ): Promise<void> {
    this.operations.push(`write:${ref.characteristicUuid}:${toHex(bytes)}`);

    return this.options.write?.() ?? Promise.resolve();
  }

  async subscribe(
    ref: Parameters<BleTransport["subscribe"]>[0],
    listener: NotificationListener,
  ): Promise<() => void> {
    this.operations.push(`subscribe:${ref.characteristicUuid}`);
    await this.options.beforeSubscribe?.();

    const recipients =
      this.listeners.get(ref.characteristicUuid) ?? new Set<NotificationListener>();

    this.listeners.set(ref.characteristicUuid, recipients);
    recipients.add(listener);
    this.historical.push(listener);

    return () => {
      recipients.delete(listener);
    };
  }

  watchAdvertisements(): () => void {
    return noop;
  }
  onDisconnected(listener: () => void): () => void {
    this.disconnected = listener;

    return noop;
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  drop(): void {
    this.disconnected();
  }

  notify(uuid: string, hex: string): void {
    for (const listener of this.listeners.get(uuid) ?? []) {
      listener(view(hex));
    }
  }

  listenerCount(): number {
    let count = 0;

    for (const recipients of this.listeners.values()) {
      count += recipients.size;
    }

    return count;
  }

  late(): void {
    for (const listener of this.historical) {
      listener(view(RIGHT_PRESSED));
    }
  }
}

export function rig(options: RigOptions = {}) {
  const clock = createManualClock();
  const ticker = createManualTicker();
  const bus = options.bus ?? createEventBus();
  const events: DeviceEvent[] = [];
  bus.subscribe("controller.button", (event) => {
    events.push(event);
  });
  const transport = new PlayTestTransport(options);

  const adapter = createPlayAdapter({
    bus,
    clock,
    ticker,
    transport,
    side: options.side ?? "right",
  });

  return {
    adapter,
    clock,
    ticker,
    events: (): readonly DeviceEvent[] => events,
    operations: (): readonly string[] => transport.operations,
    selections: (): readonly string[] => transport.selections,
    input: (hex: string) => {
      transport.notify(ZWIFT_PLAY_MEASUREMENT, hex);
    },
    reply: (hex: string = RIDE_ON) => {
      transport.notify(ZWIFT_PLAY_COMMAND_RESPONSE, hex);
    },
    drop: () => {
      transport.drop();
    },
    setId: (id: string) => {
      transport.setId(id);
    },
    listenerCount: () => transport.listenerCount(),
    late: () => {
      transport.late();
    },
  };
}
