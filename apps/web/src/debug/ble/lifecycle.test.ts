import { describe, expect, it } from "vitest";
import {
  bytesToDataView,
  createManualClock,
  createManualTicker,
  createReplayTransport,
  parseBleFixtureJson,
  INDOOR_BIKE_DATA,
  FITNESS_MACHINE_SERVICE,
  type BleTransport,
  type NotificationListener,
  type BleFixture,
} from "@voltonaut/ble";
import { SNIFFER_FIXTURE } from "@voltonaut/ble/testdata";
import { createSnifferSession } from "./session.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: [] };
const ref = { serviceUuid: FITNESS_MACHINE_SERVICE, characteristicUuid: INDOOR_BIKE_DATA };
const payload = bytesToDataView(Uint8Array.from([0x45, 0, 180, 0, 244, 0]));

function deferred() {
  let resolve: (() => void) | undefined;
  let reject: ((error: Readonly<Error>) => void) | undefined;

  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });

  return {
    promise,
    resolve: () => {
      resolve?.();
    },
    reject: (error: Readonly<Error>) => {
      reject?.(error);
    },
  };
}

function nativeSubscription(pending: Readonly<Promise<void>>) {
  const listeners = new Set<NotificationListener>();
  let starts = 0;
  let stops = 0;

  const subscribe: BleTransport["subscribe"] = (_ref, listener) => {
    starts += 1;
    listeners.add(listener);
    let active = true;

    return pending.then(() => () => {
      if (active) {
        active = false;
        stops += 1;
        listeners.delete(listener);
      }
    });
  };

  return {
    subscribe,
    starts: () => starts,
    stops: () => stops,
    emit: () => {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}

function deferredTransport() {
  const pending = deferred();
  const subscription = nativeSubscription(pending.promise);
  const disconnects = new Set<() => void>();

  const transport: BleTransport = {
    ...createReplayTransport({
      fixture: SNIFFER_FIXTURE,
      clock: createManualClock(),
      ticker: createManualTicker(),
    }),
    subscribe: subscription.subscribe,
    onDisconnected: (listener) => {
      disconnects.add(listener);

      return () => {
        disconnects.delete(listener);
      };
    },
  };

  return {
    transport,
    starts: subscription.starts,
    stops: subscription.stops,
    ready: () => {
      pending.resolve();
    },
    fail: () => {
      pending.reject(new Error("notify failed"));
    },
    drop: () => {
      for (const listener of disconnects) {
        listener();
      }
    },
    emit: subscription.emit,
  };
}

it("shares pending native subscriptions and stops the last recipient exactly once", async () => {
  const raw = deferredTransport();
  const session = createSnifferSession(raw.transport, () => {});
  let received = 0;

  const first = session.transport.subscribe(ref, () => {
    received += 1;
  });

  const second = session.transport.subscribe(ref, () => {
    received += 1;
  });

  expect(raw.starts()).toBe(1);
  raw.ready();
  const stopFirst = await first;
  const stopSecond = await second;
  raw.emit();
  expect(received).toBe(2);
  expect(session.fixture("", "").log).toHaveLength(1);
  stopFirst();
  expect(raw.stops()).toBe(0);
  stopSecond();
  stopSecond();
  expect(raw.stops()).toBe(1);
  raw.emit();
  expect(received).toBe(2);
  expect(session.fixture("", "").log).toHaveLength(1);
  await session.dispose();
});

it("cancels a pending native subscription during teardown", async () => {
  const raw = deferredTransport();
  const session = createSnifferSession(raw.transport, () => {});
  const pending = session.transport.subscribe(ref, () => {});
  await session.dispose();
  raw.emit();
  raw.ready();
  await expect(pending).rejects.toThrow("cancelled");
  expect(raw.stops()).toBe(1);
  expect(session.fixture("", "").log).toHaveLength(0);
});

it("drops stale callbacks on disconnect and records once after reconnect", async () => {
  const raw = deferredTransport();
  const session = createSnifferSession(raw.transport, () => {});
  raw.ready();
  await session.transport.connect(scan, "select");
  await session.observe(ref);
  await session.observe(ref);
  expect(raw.starts()).toBe(1);
  raw.emit();
  raw.drop();
  raw.emit();
  await session.transport.connect(scan, "remembered");
  await session.observe(ref);
  raw.emit();
  expect(raw.starts()).toBe(2);
  expect(session.fixture("", "").log.filter((entry) => entry.kind === "data")).toHaveLength(2);
  await session.transport.disconnect();
  await session.dispose();
  expect(raw.stops()).toBe(2);
});

it("propagates native start failures without retaining recipients", async () => {
  const raw = deferredTransport();
  const session = createSnifferSession(raw.transport, () => {});
  const pending = session.transport.subscribe(ref, () => {});
  raw.fail();
  await expect(pending).rejects.toThrow("notify failed");
  raw.emit();
  expect(session.fixture("", "").log).toHaveLength(0);
  await session.dispose();
});

it("owns pending observations once and cancels them without resurrecting after clear", async () => {
  const raw = deferredTransport();
  const session = createSnifferSession(raw.transport, () => {});
  const first = session.observe(ref);
  const second = session.observe(ref);
  expect(session.isObserving(ref)).toBe(true);
  expect(raw.starts()).toBe(1);
  raw.drop();
  expect(session.isObserving(ref)).toBe(false);
  raw.ready();
  await expect(first).rejects.toThrow("cancelled");
  await expect(second).rejects.toThrow("cancelled");
  expect(session.isObserving(ref)).toBe(false);
  await session.observe(ref);
  expect(raw.starts()).toBe(2);
  session.unobserve(ref);
  await Promise.resolve();
  raw.emit();
  expect(session.fixture("", "").log.filter((entry) => entry.kind === "data")).toHaveLength(0);
  await session.dispose();
});

it("cancels a pending observation without losing another notification recipient", async () => {
  const raw = deferredTransport();
  const session = createSnifferSession(raw.transport, () => {});
  let replies = 0;
  const observer = session.observe(ref);

  const recipient = session.transport.subscribe(ref, () => {
    replies += 1;
  });

  session.unobserve(ref);
  expect(session.isObserving(ref)).toBe(false);
  raw.ready();
  await observer;
  const stop = await recipient;
  raw.emit();
  expect(replies).toBe(1);
  expect(raw.stops()).toBe(0);
  stop();
  expect(raw.stops()).toBe(1);
  await session.dispose();
});

function parsedFixture(text: string): BleFixture {
  const parsed = parseBleFixtureJson(text);

  if (!parsed.ok) {
    throw new Error(parsed.failure.reason);
  }

  return parsed.value;
}

async function roundtrip(captureStartMs: number): Promise<number> {
  let nowMs = captureStartMs;
  const raw = deferredTransport();
  raw.ready();

  const session = createSnifferSession(
    raw.transport,
    () => {},
    () => nowMs,
  );

  await session.transport.connect(scan);
  await session.transport.subscribe(ref, () => {});
  nowMs += 250;
  raw.emit();
  nowMs += 250;
  session.marker("RS");
  const fixture = parsedFixture(JSON.stringify(session.fixture("synthetic", "roundtrip")));
  expect(fixture.log.map((entry) => entry.tMs)).toEqual([0, 250, 500]);
  const clock = createManualClock();
  const ticker = createManualTicker();
  const replay = createReplayTransport({ fixture, clock, ticker });
  await replay.connect(scan);
  let frames = 0;
  await replay.subscribe(ref, () => {
    frames += 1;
  });
  ticker.tick();
  expect(frames).toBe(0);
  clock.advanceS(0.25);
  ticker.tick();
  expect(frames).toBe(1);
  await replay.disconnect();
  await session.dispose();

  return frames;
}

describe("capture export and replay", () => {
  it("replays from t=0 for repeated sessions on a continuing monotonic clock", async () => {
    expect(await roundtrip(900_000)).toBe(1);
    expect(await roundtrip(1_800_000)).toBe(1);
  });
});
