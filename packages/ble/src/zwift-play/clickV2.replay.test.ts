import { expect, it } from "vitest";
import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import {
  createPlayAdapter,
  toHex,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_V2_SERVICE,
} from "../index.js";
import {
  CLICK_CAPTURE,
  buttonTrail,
  firstWriteMs,
  summarizeClick,
} from "../testdata/hubClickCaptures.js";
import { replayCapture } from "../testdata/captureReplay.js";

it("decodes every frame of the genuine right puck", () => {
  expect(summarizeClick(CLICK_CAPTURE)).toMatchObject({ frames: 120, parseFailures: 0 });
});

it.each([
  ["+", "plus"],
  ["b", "b"],
  ["a", "a"],
  ["y", "y"],
  ["z", "z"],
] as const)("marker %s shows exactly the %s button pressed", (marker, button) => {
  expect(summarizeClick(CLICK_CAPTURE).pressedByMarker.get(marker)).toEqual([button]);
});

it("replays the genuine capture through the real adapter: one handshake, + up, B down", async () => {
  const startedMs = firstWriteMs(CLICK_CAPTURE);
  const replay = replayCapture(CLICK_CAPTURE, startedMs);
  const bus = createEventBus();
  const events: DeviceEvent[] = [];

  bus.subscribe("controller.button", (event) => {
    events.push(event);
  });

  const adapter = createPlayAdapter({
    bus,
    clock: { nowS: () => replay.nowS() - startedMs / 1000 },
    ticker: replay.ticker,
    transport: replay.transport,
    side: "right",
  });

  const connected = adapter.select();
  await expect.poll(() => replay.transport.written().length).toBe(1);
  await replay.until(Number.POSITIVE_INFINITY);
  await connected;

  expect(adapter.status()).toBe("ready");
  expect(adapter.description()).toContain("Rechter Click-v2-Puck bestätigt");
  expect(
    replay.transport.written().map((frame) => ({ ref: frame.ref, hex: toHex(frame.bytes) })),
  ).toEqual([
    {
      ref: { serviceUuid: ZWIFT_PLAY_V2_SERVICE, characteristicUuid: ZWIFT_PLAY_CONTROL_POINT },
      hex: "52 69 64 65 4f 6e 02 03",
    },
  ]);
  // Unmarked + then B, then the marked +, +, B; A, Y and Z do not shift.
  expect(buttonTrail(events)).toEqual([
    "shiftUp:true",
    "shiftUp:false",
    "shiftDown:true",
    "shiftDown:false",
    "shiftUp:true",
    "shiftUp:false",
    "shiftUp:true",
    "shiftUp:false",
    "shiftDown:true",
    "shiftDown:false",
  ]);
  await adapter.disconnect();
});
