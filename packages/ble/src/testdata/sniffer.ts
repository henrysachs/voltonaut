import { parseBleFixtureJson, type BleFixture } from "../fixtureSchema.js";

function parseSyntheticFixture(text: string): BleFixture {
  const parsed = parseBleFixtureJson(text);

  if (!parsed.ok) {
    throw new Error(parsed.failure.reason);
  }

  return parsed.value;
}

export const SNIFFER_FIXTURE = parseSyntheticFixture(
  JSON.stringify({
    meta: {
      schemaVersion: 1,
      ua: "synthetic",
      date: "2026-11-20T10:00:00.000Z",
      deviceName: "Replay trainer",
      deviceId: "replay-1",
      protocol: "raw",
    },
    gatt: [
      {
        service: "0x1826",
        characteristics: [
          { char: "0x2acc", properties: ["read"], descriptors: ["0x2901"] },
          { char: "0x2ad2", properties: ["notify"] },
          { char: "0x2ad9", properties: ["write", "indicate"] },
        ],
      },
      { service: "0x180d", characteristics: [{ char: "0x2a37", properties: ["notify"] }] },
      {
        service: "00000001-19ca-4651-86e5-fa29dcdd09d1",
        characteristics: [
          { char: "00000002-19ca-4651-86e5-fa29dcdd09d1", properties: ["notify"] },
          { char: "00000003-19ca-4651-86e5-fa29dcdd09d1", properties: ["write"] },
          { char: "00000004-19ca-4651-86e5-fa29dcdd09d1", properties: ["indicate"] },
        ],
      },
    ],
    log: [
      { tMs: 0, service: "0x1826", char: "0x2acc", hex: "2b 14 00 00 08 20 00 00" },
      { tMs: 500, service: "0x1826", char: "0x2ad2", hex: "45 00 b0 00 fa 00" },
      { tMs: 500, service: "0x180d", char: "0x2a37", hex: "00 40" },
      { tMs: 1000, service: "0x1826", char: "0x2ad9", hex: "80 00 01" },
      { tMs: 1250, service: "0x1826", char: "0x2ad9", hex: "80 11 01" },
      { tMs: 1500, service: "0x1826", char: "0x2ad9", hex: "80 11 01" },
    ].map((entry: Readonly<{ tMs: number; service: string; char: string; hex: string }>) => ({
      tMs: entry.tMs,
      service: entry.service,
      char: entry.char,
      hex: entry.hex,
      dir: "rx",
      device: "Replay trainer",
    })),
  }),
);
