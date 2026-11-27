import { expect, it } from "vitest";
import {
  FITNESS_MACHINE_SERVICE,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_V2_SERVICE,
} from "../uuids.js";
import {
  CLICK_V2_B,
  CLICK_V2_MINUS,
  CLICK_V2_PLUS,
  CLICK_V2_PROFILE,
  CLICK_V2_RELEASED,
  RIDE_ON_CLICK_V2,
  rig,
} from "../testdata/playRig.js";

async function connected(target: Readonly<ReturnType<typeof rig>>) {
  const connecting = target.adapter.select();
  await expect.poll(() => target.operations().length).toBe(3);

  return { connecting };
}

it("uses service fc82 and the 8-byte handshake, and accepts the reply with a device key", async () => {
  const target = rig({ profile: CLICK_V2_PROFILE });
  const { connecting } = await connected(target);
  expect(target.operations()).toEqual([
    `subscribe:${ZWIFT_PLAY_MEASUREMENT}`,
    `subscribe:${ZWIFT_PLAY_COMMAND_RESPONSE}`,
    `write:${ZWIFT_PLAY_CONTROL_POINT}:${RIDE_ON_CLICK_V2}`,
  ]);
  expect(target.services().every((uuid) => uuid === ZWIFT_PLAY_V2_SERVICE)).toBe(true);
  target.reply(`${RIDE_ON_CLICK_V2} 0a 41 04 aa bb`);
  expect(target.adapter.status()).toBe("handshaking");
  target.input(CLICK_V2_RELEASED);
  expect(target.adapter.status()).toBe("handshaking");
  target.input(CLICK_V2_PLUS);
  await connecting;
  expect(target.adapter.status()).toBe("ready");
  expect(target.adapter.description()).toContain("Rechter Click-v2-Puck bestätigt");
  expect(target.events()).toMatchObject([
    { button: "shiftUp", pressed: true, source: "clickV2:approved-device:right" },
  ]);
});

it("shifts once per press: + up and B down on the right puck, held frames repeat nothing", async () => {
  const target = rig({ profile: CLICK_V2_PROFILE });
  const { connecting } = await connected(target);
  target.reply(RIDE_ON_CLICK_V2);
  target.input(CLICK_V2_PLUS);
  await connecting;

  for (let count = 0; count < 20; count += 1) target.input(CLICK_V2_PLUS);

  target.input(CLICK_V2_RELEASED);
  target.input(CLICK_V2_B);
  target.input(CLICK_V2_B);
  target.input(CLICK_V2_RELEASED);
  expect(target.events()).toMatchObject([
    { button: "shiftUp", pressed: true },
    { button: "shiftUp", pressed: false },
    { button: "shiftDown", pressed: true },
    { button: "shiftDown", pressed: false },
  ]);
});

it("confirms the left puck through − and shifts down", async () => {
  const target = rig({ profile: CLICK_V2_PROFILE, side: "left" });
  const { connecting } = await connected(target);
  target.reply(RIDE_ON_CLICK_V2);
  target.input(CLICK_V2_MINUS);
  await connecting;
  target.input(CLICK_V2_RELEASED);
  expect(target.adapter.description()).toContain("Linker Click-v2-Puck bestätigt");
  expect(target.events()).toMatchObject([
    { button: "shiftDown", pressed: true, source: "clickV2:approved-device:left" },
    { button: "shiftDown", pressed: false },
  ]);
});

it("rejects the right puck in the left slot without shifting", async () => {
  const target = rig({ profile: CLICK_V2_PROFILE, side: "left" });
  const { connecting } = await connected(target);
  target.reply(RIDE_ON_CLICK_V2);
  target.input(CLICK_V2_PLUS);
  await connecting;
  expect(target.adapter.status()).toBe("error");
  expect(target.adapter.description()).toContain("Falscher Click-v2-Puck: rechts erkannt");
  expect(target.events()).toEqual([]);
});

it("explains a locked puck instead of failing silently", async () => {
  const target = rig({ profile: CLICK_V2_PROFILE });
  const { connecting } = await connected(target);
  target.reply(RIDE_ON_CLICK_V2);
  target.input(CLICK_V2_PLUS);
  await connecting;
  target.input("ff 05 00 ea 05");
  expect(target.adapter.status()).toBe("ready");
  expect(target.adapter.description()).toContain("Zwift-App");
});

it("rejects a Play-style reply on a Click v2 without further writes", async () => {
  const target = rig({ profile: CLICK_V2_PROFILE });
  const { connecting } = await connected(target);
  target.reply("52 69 64 65 4f 6e 01 03");
  await connecting;
  expect(target.adapter.status()).toBe("error");
  expect(target.operations().filter((op) => op.startsWith("write:"))).toHaveLength(1);
});

const ZWIFT_CHANNELS = CLICK_V2_PROFILE.services[0]?.characteristics ?? [];

it("refuses a trainer that also offers the proprietary Zwift service (ADR-001)", async () => {
  const hub = rig({
    profile: {
      services: [
        { uuid: ZWIFT_PLAY_LEGACY_SERVICE, characteristics: ZWIFT_CHANNELS },
        { uuid: FITNESS_MACHINE_SERVICE, characteristics: [] },
      ],
    },
  });

  await hub.adapter.select();
  expect(hub.adapter.status()).toBe("error");
  expect(hub.adapter.description()).toContain("Trainer");
  expect(hub.operations()).toEqual([]);
});
