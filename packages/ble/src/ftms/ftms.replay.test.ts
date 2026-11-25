import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createTrainerAdapter } from "./adapter.js";
import type { BleFixture, BleFixtureParseResult } from "../fixtureSchema.js";
import { parseBleFixtureJson } from "../fixtureSchema.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import { createReplayTransport, type ReplayTransport } from "../replay/ReplayTransport.js";
import { createCpsSyntheticFixture, createFtmsSyntheticFixture } from "../testdata/index.js";

function createTransportFromFixture(
  fixture: BleFixture,
  clock: ReturnType<typeof createManualClock>,
  ticker: ReturnType<typeof createManualTicker>,
): ReplayTransport {
  const parsed = parseBleFixtureJson(JSON.stringify(fixture));

  expect(parsed.ok).toBe(true);

  return createReplayTransport({ fixture: fixtureFromResult(parsed), clock, ticker });
}

function fixtureFromResult(parsed: BleFixtureParseResult): BleFixture {
  return parsed.ok ? parsed.value : unreachableFixture();
}

function unreachableFixture(): BleFixture {
  throw new Error("expected the fixture to parse");
}

function advanceOneSecondPerTick(
  seconds: number,
  clock: ReturnType<typeof createManualClock>,
  ticker: ReturnType<typeof createManualTicker>,
): void {
  for (let second = 0; second < seconds; second += 1) {
    clock.advanceS(1);
    ticker.tick();
  }
}

describe("trainer adapter replay (AK4c)", () => {
  it("emits the expected trainer.data sequence and decodes the feature read", async () => {
    const { fixture, expectedEvents } = createFtmsSyntheticFixture();
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createTransportFromFixture(fixture, clock, ticker);
    const adapter = createTrainerAdapter({ bus, clock, ticker, clockScale: 1, transport });
    const events: DeviceEvent[] = [];

    bus.subscribe("trainer.data", (event) => {
      events.push(event);
    });

    await adapter.connect();
    expect(adapter.status()).toBe("ready");
    expect(adapter.protocol()).toBe("ftms");
    expect(adapter.features()?.machineDwordHex).toBe("0x0000142b");
    expect(adapter.features()?.targetFeatures).toContain("powerTarget");
    expect(adapter.features()?.targetFeatures).toContain("indoorBikeSimulationParameters");

    advanceOneSecondPerTick(120, clock, ticker);
    expect(events).toEqual(expectedEvents);
    expect(transport.written()).toEqual([]);
  });
});

it("uses the same trainer adapter for a CPS-only trainer without writing", async () => {
  const { fixture, expectedEvents } = createCpsSyntheticFixture();
  const bus = createEventBus();
  const clock = createManualClock();
  const ticker = createManualTicker();
  const transport = createTransportFromFixture(fixture, clock, ticker);
  const adapter = createTrainerAdapter({ bus, clock, ticker, clockScale: 1, transport });
  const events: DeviceEvent[] = [];

  bus.subscribe("trainer.data", (event) => {
    events.push(event);
  });
  await adapter.connect();
  expect(adapter.status()).toBe("ready");
  expect(adapter.protocol()).toBe("cps");
  advanceOneSecondPerTick(30, clock, ticker);
  expect(events).toEqual(expectedEvents);
  expect(transport.written()).toEqual([]);
});

describe("trainer without data services", () => {
  it("ends in error when the device has neither FTMS data nor cycling power", async () => {
    const { fixture } = createFtmsSyntheticFixture();

    const strippedFixture = {
      ...fixture,
      gatt: [
        {
          service: "0x1826",
          characteristics: [{ char: "0x2AD9", properties: ["write", "indicate"], descriptors: [] }],
        },
      ],
    };

    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createTransportFromFixture(strippedFixture, clock, ticker);
    const adapter = createTrainerAdapter({ bus, clock, ticker, clockScale: 1, transport });

    await adapter.connect();
    expect(adapter.status()).toBe("error");
    expect(adapter.protocol()).toBe("none");
  });
});
