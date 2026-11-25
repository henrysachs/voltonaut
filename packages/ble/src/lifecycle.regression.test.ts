import { createEventBus } from "@voltonaut/shared";
import { expect, it } from "vitest";
import { createCpsTrainerAdapter } from "./cps/adapter.js";
import { createHeartRateAdapter } from "./hrs/adapter.js";
import { createTrainerAdapter, type TrainerAdapterOptions } from "./ftms/adapter.js";
import { createManualClock } from "./sim/clock.js";
import { createManualTicker } from "./sim/tick.js";
import { createTestCentral } from "./testdata/webCentral.js";
import { createWebBluetoothTransport } from "./webBluetoothTransport.js";
import {
  CYCLING_POWER_SERVICE,
  CYCLING_POWER_MEASUREMENT,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
  HEART_RATE_SERVICE,
  HEART_RATE_MEASUREMENT,
} from "./uuids.js";

function noop(): void {}

function completed(): Promise<void> {
  return Promise.resolve();
}

function deferred() {
  let finish = noop;

  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return {
    promise,
    resolve: () => {
      finish();
    },
  };
}

function flush(depth = 100): Promise<void> {
  return depth === 0 ? Promise.resolve() : Promise.resolve().then(() => flush(depth - 1));
}

function assertGattIdle(stopping: boolean): Promise<void> {
  return stopping
    ? Promise.reject(new Error("GATT operation already in progress"))
    : Promise.resolve();
}

async function advance(
  clock: ReturnType<typeof createManualClock>,
  ticker: ReturnType<typeof createManualTicker>,
  seconds: number,
): Promise<void> {
  clock.advanceS(seconds);
  ticker.tick();
  await flush();
}

const disconnectedEvent = { manufacturerData: new Map(), serviceData: new Map() };

it("emits zero cadence after three seconds without crank progress, not between revolutions", async () => {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();

  const fake = createTestCentral({
    serviceUuid: CYCLING_POWER_SERVICE,
    characteristicUuid: CYCLING_POWER_MEASUREMENT,
  });

  const adapter = createCpsTrainerAdapter({
    bus,
    clock,
    ticker,
    transport: createWebBluetoothTransport({ central: fake.central }),
  });

  const cadences: (number | undefined)[] = [];
  bus.subscribe("trainer.data", (event) => {
    cadences.push(event.cadenceRpm);
  });
  await adapter.connect();
  fake.notify([0x20, 0, 200, 0, 100, 0, 0xe8, 3]);
  clock.advanceS(1);
  fake.notify([0x20, 0, 200, 0, 102, 0, 0xe8, 7]);
  expect(cadences.at(-1)).toBe(120);
  clock.advanceS(0.1);
  fake.notify([0x20, 0, 0, 0, 102, 0, 0xe8, 7]);
  expect(cadences.at(-1)).toBeUndefined();
  clock.advanceS(2.9);
  fake.notify([0x20, 0, 0, 0, 102, 0, 0xe8, 7]);
  expect(cadences.at(-1)).toBe(0);
  clock.advanceS(120);
  fake.notify([0x20, 0, 0, 0, 102, 0, 0xe8, 7]);
  expect(cadences.at(-1)).toBe(0);
  clock.advanceS(1);
  fake.notify([0x20, 0, 200, 0, 104, 0, 0xe8, 11]);
  expect(cadences.at(-1)).toBe(120);
});

it("preserves terminal error after late native disconnect and allows manual recovery", async () => {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  let startNotifications = completed;

  const fake = createTestCentral({
    startNotifications: () => startNotifications(),
  });

  const adapter = createHeartRateAdapter({
    bus,
    clock,
    ticker,
    transport: createWebBluetoothTransport({ central: fake.central }),
  });

  await adapter.connect();
  fake.event("gattserverdisconnected", disconnectedEvent);
  startNotifications = () => Promise.reject(new Error("notification setup failed"));
  await advance(clock, ticker, 1);
  await advance(clock, ticker, 1);
  await advance(clock, ticker, 3);
  await advance(clock, ticker, 5);
  await advance(clock, ticker, 5);
  expect(adapter.status()).toBe("error");
  fake.event("gattserverdisconnected", disconnectedEvent);
  expect(adapter.status()).toBe("error");
  startNotifications = completed;
  await adapter.connect();
  expect(adapter.status()).toBe("ready");
  expect(fake.requests()).toHaveLength(1);
  let samples = 0;
  bus.subscribe("hr.data", () => {
    samples += 1;
  });
  fake.notify();
  expect(samples).toBe(1);
});

interface TeardownCase {
  readonly serviceUuid: string;
  readonly characteristicUuid: string;
  readonly createAdapter: (
    options: TrainerAdapterOptions,
  ) => ReturnType<typeof createHeartRateAdapter>;
}

it.each<TeardownCase>([
  {
    serviceUuid: HEART_RATE_SERVICE,
    characteristicUuid: HEART_RATE_MEASUREMENT,
    createAdapter: createHeartRateAdapter,
  },
  {
    serviceUuid: FITNESS_MACHINE_SERVICE,
    characteristicUuid: INDOOR_BIKE_DATA,
    createAdapter: createTrainerAdapter,
  },
])(
  "serializes pending teardown before the next $serviceUuid session",
  async ({ serviceUuid, characteristicUuid, createAdapter }: TeardownCase) => {
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const stopped = deferred();
    let stopping = false;

    const fake = createTestCentral({
      serviceUuid,
      characteristicUuid,
      stopNotifications: async () => {
        stopping = true;
        await stopped.promise;
        stopping = false;
      },
      beforeConnect: () => assertGattIdle(stopping),
    });

    const options = {
      bus,
      clock,
      ticker,
      clockScale: 1,
      transport: createWebBluetoothTransport({ central: fake.central }),
    };

    const adapter = createAdapter(options);
    await adapter.connect();
    expect(adapter.status()).toBe("ready");
    const connecting = adapter.connect();
    await flush();
    const independent = createWebBluetoothTransport({ central: createTestCentral().central });
    await independent.connect({ acceptAllDevices: true, filters: [], optionalServices: [] });
    expect(independent.deviceId()).toBe("strap-1");
    stopped.resolve();
    await connecting;
    expect(adapter.status()).toBe("ready");
    expect(fake.connects()).toBe(2);
  },
);

it("does not revive an explicitly disconnected adapter when retry setup finishes", async () => {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const started = deferred();
  let startNotifications = completed;

  const fake = createTestCentral({
    startNotifications: () => startNotifications(),
  });

  const adapter = createHeartRateAdapter({
    bus,
    clock,
    ticker,
    transport: createWebBluetoothTransport({ central: fake.central }),
  });

  await adapter.connect();
  startNotifications = () => started.promise;
  fake.event("gattserverdisconnected", disconnectedEvent);
  clock.advanceS(1);
  ticker.tick();
  await flush();
  const disconnecting = adapter.disconnect();
  started.resolve();
  await disconnecting;
  await flush();
  expect(adapter.status()).toBe("disconnected");
  let samples = 0;
  bus.subscribe("hr.data", () => {
    samples += 1;
  });
  fake.notify();
  expect(samples).toBe(0);
});

it("does not let a canceled FTMS read subscribe into a newer session", async () => {
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const read = deferred();
  const nextRead = deferred();
  let beforeRead = completed;

  const fake = createTestCentral({
    serviceUuid: FITNESS_MACHINE_SERVICE,
    characteristicUuid: INDOOR_BIKE_DATA,
    beforeRead: () => beforeRead(),
  });

  const adapter = createTrainerAdapter({
    bus,
    clock,
    ticker,
    clockScale: 1,
    transport: createWebBluetoothTransport({ central: fake.central }),
  });

  await adapter.connect();
  beforeRead = () => read.promise;
  const oldConnecting = adapter.connect();
  await flush();
  const disconnecting = adapter.disconnect();
  beforeRead = () => nextRead.promise;
  const connecting = adapter.connect();
  let samples = 0;
  bus.subscribe("trainer.data", () => {
    samples += 1;
  });
  read.resolve();
  await flush();
  fake.notify([0x45, 0, 180, 0, 244, 0]);
  expect(samples).toBe(0);
  nextRead.resolve();
  await Promise.all([oldConnecting, disconnecting, connecting]);
  expect(adapter.status()).toBe("ready");
  fake.notify([0x45, 0, 180, 0, 244, 0]);
  expect(samples).toBe(1);
});
