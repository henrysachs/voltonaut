import { expect, it } from "vitest";
import { createEventBus } from "@voltonaut/shared";
import {
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_COMMAND_RESPONSE,
} from "../uuids.js";
import {
  rig,
  noop,
  RIDE_ON,
  RIGHT_PRESSED,
  RIGHT_RELEASED,
  LEFT_PRESSED,
} from "../testdata/playRig.js";

async function started(target: Readonly<ReturnType<typeof rig>>) {
  const connecting = target.adapter.select();
  await expect
    .poll(() => target.operations().filter((op) => op.startsWith("write:")).length)
    .toBeGreaterThan(0);

  return { connecting };
}

it("subscribes both channels before one RideOn and waits for response plus proven side", async () => {
  const target = rig();
  const { connecting } = await started(target);
  expect(target.operations()).toEqual([
    `subscribe:${ZWIFT_PLAY_MEASUREMENT}`,
    `subscribe:${ZWIFT_PLAY_COMMAND_RESPONSE}`,
    `write:${ZWIFT_PLAY_CONTROL_POINT}:${RIDE_ON}`,
  ]);
  expect(target.adapter.status()).toBe("handshaking");
  target.input(RIGHT_PRESSED);
  expect(target.events()).toEqual([]);
  target.reply();
  await connecting;
  expect(target.adapter.status()).toBe("ready");
  expect(target.adapter.description()).toContain("Rechter Griff bestätigt");
  expect(target.events()).toMatchObject([
    { button: "shiftUp", pressed: true, source: "play:approved-device:right" },
  ]);
  target.reply();
  expect(target.adapter.status()).toBe("ready");

  for (let count = 0; count < 50; count += 1) {
    target.input(RIGHT_PRESSED);
  }

  expect(target.events()).toHaveLength(1);
  target.input(RIGHT_RELEASED);
  target.input(RIGHT_RELEASED.replace("20 01", "20 00"));
  expect(target.events()).toMatchObject([{ pressed: true }, { pressed: false }]);
});

it("keeps independent left/right edges and sources on a common bus", async () => {
  const bus = createEventBus();
  const left = rig({ bus, side: "left" });
  const right = rig({ bus });
  left.setId("left-device");
  right.setId("right-device");
  const leftStart = await started(left);
  const rightStart = await started(right);
  left.reply();
  right.reply();
  left.input(LEFT_PRESSED);
  right.input(RIGHT_PRESSED);
  await Promise.all([leftStart.connecting, rightStart.connecting]);
  left.input(LEFT_PRESSED);
  right.input(RIGHT_PRESSED);
  expect(left.events()).toMatchObject([
    { source: "play:left-device:left", button: "shiftDown", pressed: true },
    { source: "play:right-device:right", button: "shiftUp", pressed: true },
  ]);
  await left.adapter.disconnect();
  right.input(RIGHT_PRESSED);
  expect(left.events()).toHaveLength(3);
  expect(left.events()[2]).toMatchObject({ button: "shiftDown", pressed: false });
});

it("rejects wrong-side selection with actionable explanation, then allows replacement", async () => {
  const target = rig();
  const first = await started(target);
  target.reply();
  target.input(LEFT_PRESSED);
  await first.connecting;
  expect(target.adapter.status()).toBe("error");
  expect(target.adapter.description()).toContain("links erkannt");
  expect(target.events()).toEqual([]);
  expect(target.listenerCount()).toBe(0);
  const next = target.adapter.select();
  await expect.poll(() => target.operations().length).toBe(6);
  target.reply();
  target.input(RIGHT_PRESSED);
  await next;
  expect(target.adapter.status()).toBe("ready");
  expect(target.events()).toHaveLength(1);
});

it.each(["00", `${RIDE_ON} 01 04`, Array.from({ length: 72 }, () => "00").join(" ")])(
  "rejects unobserved handshake reply %s without further writes",
  async (reply) => {
    const target = rig();
    const { connecting } = await started(target);
    target.reply(reply);
    target.input(RIGHT_PRESSED);
    await connecting;
    expect(target.adapter.status()).toBe("error");
    expect(target.listenerCount()).toBe(0);
    expect(target.events()).toEqual([]);
    expect(target.operations().filter((op) => op.startsWith("write:"))).toHaveLength(1);
  },
);

it("times out only the handshake and does not claim ready without side evidence", async () => {
  const target = rig();
  const { connecting } = await started(target);
  target.clock.advanceS(3);
  target.ticker.tick();
  await connecting;
  expect(target.adapter.status()).toBe("error");
  const retry = target.adapter.connect();
  await expect.poll(() => target.operations().length).toBe(6);
  target.reply();
  target.clock.advanceS(30);
  target.ticker.tick();
  expect(target.adapter.status()).toBe("handshaking");
  expect(target.adapter.description()).toContain("Seite noch unbekannt");
  target.input(RIGHT_RELEASED);
  await retry;
  expect(target.adapter.status()).toBe("ready");
});

it("cleans failed writes and malformed/unknown inputs cannot shift", async () => {
  const failed = rig({ write: () => Promise.reject(new Error("write failed")) });
  await failed.adapter.select();
  expect(failed.adapter.status()).toBe("error");
  expect(failed.listenerCount()).toBe(0);
  const target = rig();
  const { connecting } = await started(target);
  target.reply();
  target.input(RIGHT_RELEASED);
  await connecting;

  for (const hex of [
    "07 08 00 30 00",
    RIGHT_PRESSED.replace("08 00", "08 02"),
    `${RIGHT_PRESSED} 30 00`,
    "15 30 00",
    "19 30 00",
    "23 30 00",
  ]) {
    target.input(hex);
  }

  expect(target.events()).toEqual([]);
});

it("releases on disconnect, reconnects the approved device and rejects old listeners", async () => {
  const target = rig();
  const { connecting } = await started(target);
  target.reply();
  target.input(RIGHT_PRESSED);
  await connecting;
  target.drop();
  expect(target.events()).toMatchObject([{ pressed: true }, { pressed: false }]);
  expect(target.adapter.status()).toBe("reconnecting");
  target.late();
  expect(target.events()).toHaveLength(2);
  target.clock.advanceS(1);
  target.ticker.tick();
  await expect.poll(() => target.operations().length).toBe(6);
  target.reply();
  target.input(RIGHT_PRESSED);
  await expect.poll(() => target.adapter.status()).toBe("ready");
  expect(target.selections()).toEqual(["select", "remembered"]);
  expect(target.events()).toHaveLength(3);
  await target.adapter.disconnect();
  target.clock.advanceS(100);
  target.ticker.tick();
  target.late();
  expect(target.events()).toHaveLength(4);
  expect(target.selections()).toHaveLength(2);
});

it("cancels a pending subscribe, unsubscribes its late result and never writes", async () => {
  let finish = noop;

  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const target = rig({ beforeSubscribe: () => pending });
  const connecting = target.adapter.select();
  await expect.poll(() => target.operations().length).toBe(1);
  await target.adapter.disconnect();
  finish();
  await connecting;
  target.late();
  expect(target.events()).toEqual([]);
  expect(target.listenerCount()).toBe(0);
  expect(target.adapter.status()).toBe("disconnected");
  expect(target.operations()).toHaveLength(1);
});

it("cancels a pending handshake and ignores its late answer", async () => {
  const target = rig();
  const { connecting } = await started(target);
  await target.adapter.disconnect();
  target.reply();
  target.input(RIGHT_PRESSED);
  target.late();
  await connecting;
  expect(target.adapter.status()).toBe("disconnected");
  expect(target.events()).toEqual([]);
});

it.each([
  rig({ beforeConnect: () => Promise.reject(new Error("picker cancelled")) }),
  rig({ profile: { services: [] } }),
])(
  "handles cancelled picker and unsupported device without subscribing or writing",
  async (target: Readonly<ReturnType<typeof rig>>) => {
    await target.adapter.select();
    expect(target.adapter.status()).toBe("error");
    expect(target.operations()).toEqual([]);
  },
);
