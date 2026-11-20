import leftCapture from "../../../../fixtures/ble/zwift-play-left-hardware-20261120.json" with { type: "json" };
import rightCapture from "../../../../fixtures/ble/zwift-play-right-hardware-20261120.json" with { type: "json" };
import { expect, it } from "vitest";
import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import {
  parseBleFixtureJson,
  createReplayTransport,
  createManualTicker,
  toHex,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_LEGACY_SERVICE,
  createPlayAdapter,
  type BleFixture,
  type PlaySide,
} from "../index.js";

function capture(side: PlaySide): BleFixture {
  const parsed = parseBleFixtureJson(JSON.stringify(side === "left" ? leftCapture : rightCapture));

  if (!parsed.ok) {
    throw new Error(parsed.failure.reason);
  }

  return parsed.value;
}

function firstWriteMs(fixture: BleFixture): number {
  const entry = fixture.log.find((item) => item.kind === "data" && item.dir === "tx");

  if (entry === undefined) {
    throw new Error("hardware handshake missing");
  }

  return entry.tMs;
}

interface ReplayCase {
  readonly side: PlaySide;
  readonly button: "shiftUp" | "shiftDown";
  readonly presses: readonly boolean[];
}

const CASES: readonly ReplayCase[] = [
  { side: "left", button: "shiftDown", presses: [true, false, true, false, true, false] },
  { side: "right", button: "shiftUp", presses: [true, false, true, false] },
];

const HANDSHAKE = [
  {
    ref: { serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE, characteristicUuid: ZWIFT_PLAY_CONTROL_POINT },
    hex: "52 69 64 65 4f 6e",
  },
];

it.each(CASES)(
  "replays the complete genuine $side capture through the real adapter",
  async ({ side, button, presses }) => {
    const fixture = capture(side);
    const startedMs = firstWriteMs(fixture);
    let replayS = startedMs / 1000;
    const ticker = createManualTicker();
    const transport = createReplayTransport({ fixture, clock: { nowS: () => replayS }, ticker });
    const bus = createEventBus();
    const events: DeviceEvent[] = [];
    bus.subscribe("controller.button", (event) => {
      events.push(event);
    });

    const adapter = createPlayAdapter({
      bus,
      clock: { nowS: () => replayS - startedMs / 1000 },
      ticker,
      transport,
      side,
    });

    const connected = adapter.select();
    await expect.poll(() => transport.written().length).toBe(1);

    for (const entry of fixture.log.filter((item) => item.tMs >= startedMs)) {
      replayS = entry.tMs / 1000;
      ticker.tick();
    }

    await connected;
    expect(adapter.status()).toBe("ready");
    expect(events).toMatchObject(
      presses.map((pressed) => ({
        type: "controller.button",
        button,
        pressed,
        source: `play:hardware-play-${side}-20261120:${side}`,
      })),
    );
    expect(
      transport.written().map((frame) => ({ ref: frame.ref, hex: toHex(frame.bytes) })),
    ).toEqual(HANDSHAKE);
    await adapter.disconnect();
  },
);
