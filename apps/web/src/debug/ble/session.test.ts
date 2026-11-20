import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createManualClock,
  createManualTicker,
  createReplayTransport,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
  HEART_RATE_SERVICE,
  HEART_RATE_MEASUREMENT,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_LEGACY_SERVICE,
  bytesToDataView,
  type BleTransport,
  type ByteReader,
} from "@voltonaut/ble";
import { SNIFFER_FIXTURE } from "@voltonaut/ble/testdata";
import { createSnifferSession } from "./session.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: [] };

const PLAY_CAPTURE_BYTES = [
  "07 08 00 10 01 18 01 20 00 28 01 30 01 38 01 40 00 48 00",
  "07 08 01 10 00 18 01 20 01 28 01 30 01 38 01 40 00 48 00",
  "07 08 00 10 01 18 01 20 01 28 01 30 01 38 01 40 c7 01 48 00",
  "15 08 00",
  "19 08 00",
  "07 08",
];

function missingSubscription(): never {
  throw new Error("Subscribe first");
}

afterEach(() => vi.unstubAllGlobals());

describe("sniffer recorder", () => {
  it("decodes trainer and pulse, deduplicates subscriptions, retains markers", async () => {
    const clock = createManualClock();
    const ticker = createManualTicker();
    const raw = createReplayTransport({ fixture: SNIFFER_FIXTURE, clock, ticker });
    const session = createSnifferSession(raw, () => {});
    await session.transport.connect(scan);
    const trainer = { serviceUuid: FITNESS_MACHINE_SERVICE, characteristicUuid: INDOOR_BIKE_DATA };
    const hr = { serviceUuid: HEART_RATE_SERVICE, characteristicUuid: HEART_RATE_MEASUREMENT };
    let frames = 0;

    const stop = await session.transport.subscribe(trainer, () => {
      frames += 1;
    });

    await session.transport.subscribe(trainer, () => {});
    await session.transport.subscribe(hr, () => {});
    clock.advanceS(0.5);
    ticker.tick();
    session.marker("RS");
    const fixture = session.fixture("1.2", "synthetic");
    expect(JSON.stringify(fixture.log)).toContain('\\"powerW\\":250');
    expect(JSON.stringify(fixture.log)).toContain('\\"bpm\\":64');
    expect(fixture.meta.firmware).toBe("1.2");
    expect(fixture.log).toContainEqual(expect.objectContaining({ marker: "RS" }));
    expect(frames).toBe(1);
    stop();
  });
});

describe("sniffer encrypted response", () => {
  it("stops writes when Play responds with a device key", async () => {
    let receive: (data: ByteReader) => void = missingSubscription;

    const transport: BleTransport = {
      deviceName: () => "Play",
      deviceId: () => "play",
      connect: () => Promise.resolve({ services: [] }),
      read: () => Promise.resolve(bytesToDataView(Uint8Array.from([0]))),
      write: () => Promise.resolve(),
      subscribe: (_ref, listener) => {
        receive = listener;

        return Promise.resolve(() => {});
      },
      watchAdvertisements: () => () => {},
      onDisconnected: () => () => {},
      disconnect: () => Promise.resolve(),
    };

    const session = createSnifferSession(transport, () => {});

    const ref = {
      serviceUuid: "00000001-19ca-4651-86e5-fa29dcdd09d1",
      characteristicUuid: "00000004-19ca-4651-86e5-fa29dcdd09d1",
    };

    await session.transport.subscribe(ref, () => {});
    receive(bytesToDataView(new Uint8Array(72)));
    await expect(session.transport.write(ref, new Uint8Array(0))).rejects.toThrow(
      "Encrypted handshake",
    );
    expect(session.fixture("", "").log).toContainEqual(
      expect.objectContaining({ event: "encrypted-handshake" }),
    );
  });
});

it("uses the public Play decoder for readable captured keys and raw analog, leaving unknown frames raw", async () => {
  const clock = createManualClock();
  const ticker = createManualTicker();

  const raw = createReplayTransport({
    fixture: {
      ...SNIFFER_FIXTURE,
      log: PLAY_CAPTURE_BYTES.map((hex) => ({
        kind: "data",
        tMs: 1,
        device: "Play",
        service: ZWIFT_PLAY_LEGACY_SERVICE,
        char: ZWIFT_PLAY_MEASUREMENT,
        hex,
        dir: "rx",
        ascii: "",
        decoded: "",
        marker: "",
      })),
    },
    clock,
    ticker,
  });

  const session = createSnifferSession(
    raw,
    () => {},
    () => clock.nowS() * 1000,
  );

  await session.transport.connect(scan);
  await session.observe({
    serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE,
    characteristicUuid: ZWIFT_PLAY_MEASUREMENT,
  });
  clock.advanceS(1);
  ticker.tick();
  const log = session.fixture("", "").log;
  expect(JSON.stringify(log)).toContain('\\"a\\":true');
  expect(JSON.stringify(log)).toContain('\\"up\\":true');
  expect(JSON.stringify(log)).toContain('\\"rawAnalogLr\\":-100');
  expect(log).toContainEqual(expect.objectContaining({ hex: "15 08 00", decoded: "" }));
  expect(log).toContainEqual(expect.objectContaining({ hex: "19 08 00", decoded: "" }));
  expect(log).toContainEqual(expect.objectContaining({ hex: "07 08", decoded: "" }));
  await session.dispose();
});
