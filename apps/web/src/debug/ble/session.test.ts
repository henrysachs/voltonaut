import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createManualClock,
  createManualTicker,
  createReplayTransport,
  FITNESS_MACHINE_SERVICE,
  INDOOR_BIKE_DATA,
  HEART_RATE_SERVICE,
  HEART_RATE_MEASUREMENT,
  bytesToDataView,
  type BleTransport,
  type ByteReader,
} from "@voltonaut/ble";
import { SNIFFER_FIXTURE } from "@voltonaut/ble/testdata";
import { createSnifferSession } from "./session.js";

const scan = { acceptAllDevices: true, filters: [], optionalServices: [] };

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
