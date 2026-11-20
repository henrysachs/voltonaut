import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { createCpsTrainerAdapter } from "./adapter.js";
import type { BleFixture, BleFixtureParseResult } from "../fixtureSchema.js";
import { parseBleFixtureJson } from "../fixtureSchema.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import { createReplayTransport, type ReplayTransport } from "../replay/ReplayTransport.js";
import { createCpsSyntheticFixture } from "../testdata/index.js";

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

describe("cycling power adapter replay (AK5)", () => {
  it("emits power on every frame and 120 rpm cadence from the second frame on", async () => {
    const { fixture, expectedEvents } = createCpsSyntheticFixture();
    const bus = createEventBus();
    const clock = createManualClock();
    const ticker = createManualTicker();
    const transport = createTransportFromFixture(fixture, clock, ticker);
    const adapter = createCpsTrainerAdapter({ bus, clock, ticker, transport, id: "cps-trainer" });
    const events: DeviceEvent[] = [];

    bus.subscribe("trainer.data", (event) => {
      events.push(event);
    });

    await adapter.connect();
    expect(adapter.status()).toBe("ready");

    advanceOneSecondPerTick(30, clock, ticker);
    expect(events).toEqual(expectedEvents);
  });
});
