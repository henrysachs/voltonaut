import { describe, expect, it } from "vitest";

import { byteReader, readerBytes, readOnlyBytes, toHex, type ByteReader } from "../bytes.js";
import type { BleFixture, BleGattService, BleLogEntry } from "../fixtureSchema.js";
import { createManualClock } from "../sim/clock.js";
import { createManualTicker } from "../sim/tick.js";
import type { CharacteristicRef, GattProfile } from "../transport.js";
import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE } from "../uuids.js";
import { createReplayTransport, type ReplayTransport } from "./ReplayTransport.js";

const hrRef: CharacteristicRef = {
  serviceUuid: HEART_RATE_SERVICE,
  characteristicUuid: HEART_RATE_MEASUREMENT,
};

const HR_GATT: readonly BleGattService[] = [
  {
    service: "0x180D",
    characteristics: [{ char: "0x2A37", properties: ["notify"], descriptors: [] }],
  },
];

function rxEntry(tMs: number, hex: string, service = "0x180D", char = "0x2A37"): BleLogEntry {
  return {
    kind: "data",
    tMs,
    device: "Chest Strap",
    service,
    char,
    dir: "rx",
    hex,
    ascii: "",
    decoded: "",
    marker: "",
  };
}

function txEntry(tMs: number, hex: string): BleLogEntry {
  return {
    kind: "data",
    tMs,
    device: "Chest Strap",
    service: "0x180D",
    char: "0x2A37",
    dir: "tx",
    hex,
    ascii: "",
    decoded: "",
    marker: "",
  };
}

function eventEntry(tMs: number, event: string): BleLogEntry {
  return { kind: "event", tMs, device: "Chest Strap", event, marker: "" };
}

function fixtureWithLog(
  log: readonly BleLogEntry[],
  gatt: readonly BleGattService[] = HR_GATT,
): BleFixture {
  return {
    meta: {
      schemaVersion: 1,
      ua: "vitest",
      date: "2026-11-20T10:00:00.000Z",
      deviceName: "Chest Strap",
      deviceId: "strap-1",
      firmware: "",
      protocol: "hrs",
      notes: "",
    },
    gatt,
    log,
  };
}

function deliveredHex(data: ByteReader): string {
  return toHex(readOnlyBytes(readerBytes(data)));
}

async function connect(fixture: BleFixture): Promise<{
  transport: ReplayTransport;
  clock: ReturnType<typeof createManualClock>;
  ticker: ReturnType<typeof createManualTicker>;
}> {
  const clock = createManualClock();
  const ticker = createManualTicker();
  const transport = createReplayTransport({ fixture, clock, ticker });
  await transport.connect({ acceptAllDevices: true, filters: [], optionalServices: [] });

  return { transport, clock, ticker };
}

describe("createReplayTransport", () => {
  it("plays every rx entry to the subscriber in fixture order", async () => {
    const { transport, clock, ticker } = await connect(
      fixtureWithLog([rxEntry(1000, "00 40"), rxEntry(2000, "01 96 00"), rxEntry(60000, "00 50")]),
    );

    const frames: string[] = [];
    await transport.subscribe(hrRef, (data) => {
      frames.push(deliveredHex(data));
    });

    clock.advanceS(2);
    ticker.tick();
    expect(frames).toEqual(["00 40", "01 96 00"]);

    clock.advanceS(58);
    ticker.tick();
    expect(frames).toEqual(["00 40", "01 96 00", "00 50"]);
  });

  it("keeps entries back until the clock reaches them and skips tx history", async () => {
    const { transport, clock, ticker } = await connect(
      fixtureWithLog([rxEntry(5000, "00 40"), txEntry(6000, "00")]),
    );

    const frames: string[] = [];
    await transport.subscribe(hrRef, (data) => {
      frames.push(deliveredHex(data));
    });

    clock.advanceS(4);
    ticker.tick();
    expect(frames).toEqual([]);
    clock.advanceS(2);
    ticker.tick();
    expect(frames).toEqual(["00 40"]);
  });
});

describe("replay GATT operations", () => {
  it("returns the gatt profile with normalized uuids", async () => {
    const { transport } = await connect(fixtureWithLog([], HR_GATT));

    const profile: GattProfile = await transport.connect({
      acceptAllDevices: true,
      filters: [],
      optionalServices: [],
    });

    expect(profile.services[0]?.uuid).toBe(HEART_RATE_SERVICE);
    expect(profile.services[0]?.characteristics[0]?.uuid).toBe(HEART_RATE_MEASUREMENT);
    expect(transport.deviceName()).toBe("Chest Strap");
    expect(transport.deviceId()).toBe("strap-1");
  });

  it("records writes and answers reads from the next unread rx entry", async () => {
    const { transport } = await connect(fixtureWithLog([rxEntry(100, "00 40")]));

    await transport.write(hrRef, Uint8Array.from([0x00]));
    expect(transport.written()).toHaveLength(1);
    expect(transport.written().map((frame) => toHex(frame.bytes))).toEqual(["00"]);

    const view = await transport.read(hrRef);
    expect(deliveredHex(byteReader(view))).toBe("00 40");
    await expect(transport.read(hrRef)).rejects.toThrow("no unread response");
  });
});

describe("replay connection lifecycle", () => {
  it("fires onDisconnected at the fixture event and resumes after a reconnect", async () => {
    const { transport, clock, ticker } = await connect(
      fixtureWithLog([
        rxEntry(1000, "00 40"),
        eventEntry(2000, "disconnected"),
        rxEntry(3000, "00 50"),
      ]),
    );

    const frames: string[] = [];
    let disconnects = 0;
    await transport.subscribe(hrRef, (data) => {
      frames.push(deliveredHex(data));
    });

    const stopDisconnected = transport.onDisconnected(() => {
      disconnects += 1;
    });

    clock.advanceS(1);
    ticker.tick();
    expect(frames).toEqual(["00 40"]);

    clock.advanceS(1);
    ticker.tick();
    expect(disconnects).toBe(1);
    expect(frames).toEqual(["00 40"]);

    clock.advanceS(1);
    ticker.tick();
    expect(disconnects).toBe(1);

    await transport.connect({ acceptAllDevices: true, filters: [], optionalServices: [] });
    await transport.subscribe(hrRef, (data) => {
      frames.push(deliveredHex(data));
    });
    ticker.tick();
    expect(frames).toEqual(["00 40", "00 50"]);
    expect(disconnects).toBe(1);
    stopDisconnected();
  });
});

describe("replay disconnected delivery", () => {
  it("drops undeliverable entries instead of throwing", async () => {
    const { transport, clock, ticker } = await connect(
      fixtureWithLog([rxEntry(100, "00 40", "0x9999", "0x2A37")]),
    );

    expect(() => {
      clock.advanceS(1);
      ticker.tick();
    }).not.toThrow();
    await expect(transport.read(hrRef)).rejects.toThrow("no unread response");
  });

  it("stops delivering after disconnect()", async () => {
    const { transport, clock, ticker } = await connect(fixtureWithLog([rxEntry(1000, "00 40")]));

    await transport.disconnect();
    clock.advanceS(10);
    ticker.tick();

    const frames: string[] = [];
    await transport.subscribe(hrRef, (data) => {
      frames.push(deliveredHex(data));
    });
    await transport.connect({ acceptAllDevices: true, filters: [], optionalServices: [] });
    ticker.tick();
    expect(frames).toEqual(["00 40"]);
  });
});
