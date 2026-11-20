import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { byteReader, parseHex, type ByteReader } from "./bytes.js";
import { createHeartRateAdapter } from "./hrs/adapter.js";
import { createManualClock } from "./sim/clock.js";
import { createManualTicker } from "./sim/tick.js";
import type { BleTransport, GattProfile, ScanOptions } from "./transport.js";
import { HEART_RATE_SERVICE } from "./uuids.js";

interface ReconnectFakeTransport extends BleTransport {
  readonly simulateDisconnect: () => void;
  readonly failNextConnects: (count: number) => void;
  readonly deliver: (hex: string) => void;
  readonly connectCalls: () => readonly number[];
}

const HR_PROFILE: GattProfile = {
  services: [
    {
      uuid: HEART_RATE_SERVICE,
      characteristics: [
        { uuid: "00002a37-0000-1000-8000-00805f9b34fb", properties: ["notify"], descriptors: [] },
      ],
    },
  ],
};

function createChannel<T>() {
  const listeners = new Set<(value: T) => void>();

  return {
    subscribe(listener: (value: T) => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    emit(value: T) {
      for (const listener of listeners) {
        listener(value);
      }
    },
  };
}

function createReconnectFakeTransport(clock: () => number): ReconnectFakeTransport {
  const disconnected = createChannel<void>();
  const notifications = createChannel<ByteReader>();
  const connectTimes: number[] = [];
  let failuresLeft = 0;

  const transport: BleTransport = {
    deviceName: () => "Fake Strap",
    deviceId: () => "fake-strap-1",
    connect(_scan: ScanOptions) {
      connectTimes.push(clock());

      if (failuresLeft > 0) {
        failuresLeft -= 1;

        return Promise.reject(new Error("gatt connect failed"));
      }

      return Promise.resolve(HR_PROFILE);
    },
    read: () => Promise.resolve(new DataView(new ArrayBuffer(0))),
    write: () => Promise.resolve(),
    subscribe(_ref, listener) {
      return Promise.resolve(notifications.subscribe(listener));
    },
    watchAdvertisements() {
      return () => {};
    },
    onDisconnected: (listener) => disconnected.subscribe(listener),
    disconnect: () => Promise.resolve(),
  };

  return {
    ...transport,
    simulateDisconnect() {
      disconnected.emit();
    },
    failNextConnects(count) {
      failuresLeft = count;
    },
    deliver(hex: string) {
      const bytes = parseHex(hex) ?? new Uint8Array(0);
      const reader = byteReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));

      notifications.emit(reader);
    },
    connectCalls: () => connectTimes,
  };
}

interface StatusEvent {
  readonly status: string;
  readonly tS: number;
}

function collectStatusEvents(bus: ReturnType<typeof createEventBus>) {
  const statuses: StatusEvent[] = [];
  const heartRates: number[] = [];

  bus.subscribe("device.status", (event) => {
    statuses.push({ status: event.status, tS: event.tS });
  });
  bus.subscribe("hr.data", (event) => {
    heartRates.push(event.bpm);
  });

  return { events: () => statuses, heartRates: () => heartRates };
}

function flushAsyncQueue(depth = 10): Promise<void> {
  return depth === 0 ? Promise.resolve() : Promise.resolve().then(() => flushAsyncQueue(depth - 1));
}

describe("adapter reconnect schedule (AK6)", () => {
  it("attempts at t=1/2/5/10/15 s and ends in error after five failures", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createReconnectFakeTransport(() => clock.nowS());
    const adapter = createHeartRateAdapter({ bus, clock, ticker, transport });
    const { events } = collectStatusEvents(bus);

    await adapter.connect();
    expect(adapter.status()).toBe("ready");

    const initialEventCount = events().length;
    transport.simulateDisconnect();
    transport.failNextConnects(5);
    expect(adapter.status()).toBe("reconnecting");

    const advanceAndTick = async (seconds: number): Promise<void> => {
      clock.advanceS(seconds);
      ticker.tick();
      await flushAsyncQueue();
    };

    await advanceAndTick(1);
    await advanceAndTick(1);
    await advanceAndTick(3);
    await advanceAndTick(5);
    await advanceAndTick(5);
    await advanceAndTick(5);

    const reconnectEvents = events().slice(initialEventCount);
    expect(reconnectEvents.map((event) => event.status)).toEqual([
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "error",
    ]);
    expect(
      reconnectEvents.slice(0, 6).every((event, index) => event.tS === [0, 1, 2, 5, 10, 15][index]),
    ).toBe(true);
    expect(adapter.status()).toBe("error");
    expect(transport.connectCalls()).toEqual([0, 1, 2, 5, 10, 15]);
  });
});

describe("successful reconnect", () => {
  it("goes ready on the first successful attempt and resumes notifications", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createReconnectFakeTransport(() => clock.nowS());
    const adapter = createHeartRateAdapter({ bus, clock, ticker, transport });
    const { events, heartRates } = collectStatusEvents(bus);

    await adapter.connect();
    const initialEventCount = events().length;

    transport.simulateDisconnect();
    transport.failNextConnects(1);

    clock.advanceS(1);
    ticker.tick();
    await flushAsyncQueue();

    clock.advanceS(1);
    ticker.tick();
    await flushAsyncQueue();

    const reconnectEvents = events().slice(initialEventCount);
    expect(reconnectEvents.map((event) => event.status)).toEqual([
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "ready",
    ]);
    expect(adapter.status()).toBe("ready");

    transport.deliver("00 40");
    expect(heartRates()).toEqual([64]);
  });
});

it("does not reconnect after an intentional disconnect emits the native disconnect event", async () => {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const transport = createReconnectFakeTransport(() => clock.nowS());

  const adapter = createHeartRateAdapter({
    bus,
    clock,
    ticker,
    transport: {
      ...transport,
      disconnect: () => {
        transport.simulateDisconnect();

        return Promise.resolve();
      },
    },
  });

  await adapter.connect();
  await adapter.disconnect();
  clock.advanceS(20);
  ticker.tick();
  await flushAsyncQueue();
  expect(adapter.status()).toBe("disconnected");
  expect(transport.connectCalls()).toEqual([0]);
});

describe("failed initial connect", () => {
  it("reports a failed first connect as error without scheduling attempts", async () => {
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createReconnectFakeTransport(() => clock.nowS());
    const adapter = createHeartRateAdapter({ bus, clock, ticker, transport });
    const { events } = collectStatusEvents(bus);

    transport.failNextConnects(1);
    await adapter.connect();

    expect(adapter.status()).toBe("error");
    expect(events().map((event) => event.status)).toEqual(["connecting", "error"]);

    clock.advanceS(20);
    ticker.tick();
    await flushAsyncQueue();
    expect(events().map((event) => event.status)).toEqual(["connecting", "error"]);
  });
});

describe("adapter status events reach the bus (AK3/AK6 wiring)", () => {
  it("publishes connecting, handshaking and ready for a manual connect", async () => {
    const bus = createEventBus();

    const adapter = createHeartRateAdapter({
      bus,
      clock: createManualClock(),
      ticker: createManualTicker(),
      transport: createReconnectFakeTransport(() => 0),
    });

    const { events } = collectStatusEvents(bus);
    let published = 0;

    bus.subscribe("device.status", () => {
      published += 1;
    });

    await adapter.connect();

    expect(events().map((event) => event.status)).toEqual(["connecting", "handshaking", "ready"]);
    expect(published).toBe(3);
  });
});
