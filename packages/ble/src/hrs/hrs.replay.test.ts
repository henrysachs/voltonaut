import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createHeartRateAdapter } from "./adapter.js";
import type { BleFixture, BleFixtureParseResult } from "../fixtureSchema.js";
import { parseBleFixtureJson } from "../fixtureSchema.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import { createReplayTransport, type ReplayTransport } from "../replay/ReplayTransport.js";
import { createHrsSyntheticFixture } from "../testdata/index.js";

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

describe("heart rate adapter replay (AK3c)", () => {
  it("emits the expected hr.data sequence from the synthetic fixture", async () => {
    const { fixture, expectedEvents } = createHrsSyntheticFixture();
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createTransportFromFixture(fixture, clock, ticker);
    const adapter = createHeartRateAdapter({ bus, clock, ticker, transport });
    const events: DeviceEvent[] = [];

    bus.subscribe("hr.data", (event) => {
      events.push(event);
    });

    await adapter.connect();
    expect(adapter.status()).toBe("ready");

    advanceOneSecondPerTick(60, clock, ticker);
    expect(events).toEqual(expectedEvents);
  });
});
