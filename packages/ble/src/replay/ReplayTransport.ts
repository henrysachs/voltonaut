import {
  bytesCopy,
  bytesToDataView,
  parseHex,
  readOnlyBytes,
  type ReadOnlyBytes,
} from "../bytes.js";
import type { BleFixture, BleLogEntry } from "../fixtureSchema.js";
import type { SimClock } from "../sim/clock.js";
import type { TickSource } from "../sim/tick.js";
import type {
  BleTransport,
  CharacteristicRef,
  GattProfile,
  NotificationListener,
} from "../transport.js";
import { normalizeUuid } from "../uuids.js";

export interface ReplayTransportOptions {
  readonly fixture: BleFixture;
  readonly clock: SimClock;
  readonly ticker: TickSource;
}

export interface WrittenFrame {
  readonly ref: CharacteristicRef;
  readonly bytes: ReadOnlyBytes;
}

export interface ReplayTransport extends BleTransport {
  readonly written: () => readonly WrittenFrame[];
}

function key(service: string, char: string): string {
  return `${normalizeUuid(service) ?? service}/${normalizeUuid(char) ?? char}`;
}

function profileFromFixture(fixture: BleFixture): GattProfile {
  return {
    services: fixture.gatt.map((service) => ({
      uuid: normalizeUuid(service.service) ?? service.service,
      characteristics: service.characteristics.map((characteristic) => ({
        uuid: normalizeUuid(characteristic.char) ?? characteristic.char,
        properties: characteristic.properties,
        descriptors: characteristic.descriptors.map(
          (descriptor) => normalizeUuid(descriptor) ?? descriptor,
        ),
      })),
    })),
  };
}

interface ReplayDelivery {
  readonly receive: (entry: BleLogEntry, index: number) => void;
  readonly clear: () => void;
  readonly subscribe: BleTransport["subscribe"];
  readonly read: BleTransport["read"];
}

function readResponse(
  fixture: BleFixture,
  isConsumed: (index: number) => boolean,
  ref: CharacteristicRef,
): number {
  return fixture.log.findIndex(
    (entry, position) =>
      entry.kind === "data" &&
      entry.dir === "rx" &&
      !isConsumed(position) &&
      key(entry.service, entry.char) === key(ref.serviceUuid, ref.characteristicUuid),
  );
}

function readView(entry: BleLogEntry | undefined): Promise<DataView> {
  if (entry === undefined || entry.kind !== "data") {
    return Promise.reject(new Error("replay fixture has no unread response"));
  }

  const bytes = parseHex(entry.hex);

  return bytes === undefined
    ? Promise.reject(new Error("invalid replay bytes"))
    : Promise.resolve(bytesToDataView(bytes));
}

function createDelivery(fixture: BleFixture): ReplayDelivery {
  const listeners = new Map<string, Set<NotificationListener>>();
  const consumed = new Set<number>();

  return {
    clear: () => {
      listeners.clear();
    },
    subscribe: (ref, listener) => {
      const channel = key(ref.serviceUuid, ref.characteristicUuid);
      const recipients = listeners.get(channel) ?? new Set<NotificationListener>();
      listeners.set(channel, recipients);
      recipients.add(listener);

      return Promise.resolve(() => {
        recipients.delete(listener);
      });
    },
    read: (ref) => {
      const index = readResponse(fixture, (position) => consumed.has(position), ref);
      consumed.add(index);

      return readView(fixture.log[index]);
    },
    receive(entry, index) {
      if (entry.kind !== "data" || entry.dir !== "rx") {
        return;
      }

      consumed.add(index);
      const bytes = parseHex(entry.hex);

      if (bytes === undefined) {
        return;
      }

      for (const listener of listeners.get(key(entry.service, entry.char)) ?? []) {
        listener(bytesToDataView(bytes));
      }
    },
  };
}

interface ReplayLifecycle {
  readonly connect: BleTransport["connect"];
  readonly disconnect: BleTransport["disconnect"];
  readonly onDisconnected: BleTransport["onDisconnected"];
}

function lifecycle(options: ReplayTransportOptions, delivery: ReplayDelivery): ReplayLifecycle {
  let connected = false;
  let position = 0;
  const listeners = new Set<() => void>();

  options.ticker.start(() => {
    while (connected && position < options.fixture.log.length) {
      const entry = options.fixture.log[position];

      if (entry === undefined || entry.tMs > options.clock.nowS() * 1000) {
        return;
      }

      position += 1;

      if (entry.kind === "event" && entry.event === "disconnected") {
        connected = false;
        delivery.clear();

        for (const listener of listeners) {
          listener();
        }
      } else {
        delivery.receive(entry, position - 1);
      }
    }
  });

  return {
    connect: () => {
      connected = true;

      return Promise.resolve(profileFromFixture(options.fixture));
    },
    disconnect: () => {
      connected = false;
      delivery.clear();

      return Promise.resolve();
    },
    onDisconnected: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createReplayTransport(options: ReplayTransportOptions): ReplayTransport {
  const delivery = createDelivery(options.fixture);
  const connection = lifecycle(options, delivery);
  const writes: WrittenFrame[] = [];

  return {
    ...connection,
    deviceName: () => options.fixture.meta.deviceName,
    deviceId: () => options.fixture.meta.deviceId,
    read: delivery.read,
    subscribe: delivery.subscribe,
    write: (ref, bytes) => {
      writes.push({ ref, bytes: readOnlyBytes(bytesCopy(bytes)) });

      return Promise.resolve();
    },
    watchAdvertisements: () => () => {},
    written: () => writes,
  };
}
