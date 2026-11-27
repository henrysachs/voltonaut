import { expect, it } from "vitest";
import { createEventBus, type DeviceEvent } from "@voltonaut/shared";
import {
  createTrainerAdapter,
  labDeviceKind,
  labRecordedCharacteristics,
  ZWIFT_PLAY_LEGACY_SERVICE,
} from "../index.js";
import {
  HUB_CAPTURE,
  captureProfile,
  firstWriteMs,
  summarizeHub,
} from "../testdata/hubClickCaptures.js";
import { replayCapture } from "../testdata/captureReplay.js";

it("reads the genuine Hub features and every Indoor Bike Data frame", () => {
  // The crank was turned by hand, so cadence stays low.
  expect(summarizeHub(HUB_CAPTURE)).toMatchObject({
    machineDwordHex: "0x00004487",
    simulation: true,
    bikeFrames: 97,
    bikeParseFailures: 0,
    maxPowerW: 114,
    maxCadenceRpm: 28,
  });
});

it("records the Hub's second Start as failed and every simulation as success", () => {
  expect(summarizeHub(HUB_CAPTURE).responses).toEqual([
    "0:success",
    "7:success",
    "17:success",
    "17:success",
    "0:success",
    "7:failed",
    "17:success",
    "17:success",
  ]);
});

it("is a trainer for the lab, which leaves its Zwift service untouched (ADR-001)", () => {
  const profile = captureProfile(HUB_CAPTURE);

  expect(labDeviceKind(profile)).toEqual({ kind: "trainer", ftmsControl: true });
  expect(labRecordedCharacteristics(profile).map((ref) => ref.serviceUuid)).not.toContain(
    ZWIFT_PLAY_LEGACY_SERVICE,
  );
});

it("replays the genuine Hub through the real trainer adapter: data, no write before enable", async () => {
  const replay = replayCapture(HUB_CAPTURE);
  const bus = createEventBus();
  const data: DeviceEvent[] = [];

  bus.subscribe("trainer.data", (event) => {
    data.push(event);
  });

  const trainer = createTrainerAdapter({
    bus,
    clock: { nowS: replay.nowS },
    ticker: replay.ticker,
    transport: replay.transport,
    clockScale: 1,
  });

  await trainer.select();
  await replay.until(firstWriteMs(HUB_CAPTURE) - 20);

  expect(trainer.status()).toBe("ready");
  expect(trainer.protocol()).toBe("ftms");
  expect(trainer.control.view().available).toBe(true);
  expect(replay.transport.written()).toEqual([]);
  expect(data.length).toBeGreaterThan(40);
  await trainer.disconnect();
});
