import { assert, integer, property, uint8Array } from "fast-check";
import { describe, expect, it } from "vitest";

import { bytesToDataView, type ParseResult, type ReadOnlyBytes } from "../bytes.js";
import { parseIndoorBikeData, type IndoorBikeSample } from "./parse.js";

function view(bytes: readonly number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

function expectSample(result: ParseResult<IndoorBikeSample>): IndoorBikeSample {
  expect(result.ok).toBe(true);

  if (result.ok) {
    return result.value;
  }

  throw new Error("expected a parsed sample");
}

function noThrowPropertyHolds(): boolean {
  assert(
    property(uint8Array({ minLength: 0, maxLength: 64 }), (bytes: ReadOnlyBytes) => {
      // The property is the absence of a throw; both result variants pass.
      parseIndoorBikeData(bytesToDataView(bytes));
    }),
  );

  return true;
}

function roundTripPropertyHolds(): boolean {
  assert(
    property(
      integer({ min: 0, max: 65535 }),
      integer({ min: -32768, max: 32767 }),
      (cadenceRaw: number, power: number) => {
        const bytes = [0x45, 0x00, cadenceRaw & 0xff, cadenceRaw >> 8, power & 0xff, power >> 8];
        const sample = expectSample(parseIndoorBikeData(view(bytes)));

        expect(sample.cadenceRpm).toBe(cadenceRaw * 0.5);
        expect(sample.powerW).toBe(power);
      },
    ),
  );

  return true;
}

describe("parseIndoorBikeData single fields", () => {
  it("parses speed only (flags 0, inverted bit 0)", () => {
    const sample = expectSample(parseIndoorBikeData(view([0x00, 0x00, 0xdc, 0x05])));

    expect(sample.speedMps).toBeCloseTo(4.1667, 3);
    expect(sample.cadenceRpm).toBeUndefined();
    expect(sample.powerW).toBeUndefined();
  });

  it("parses cadence only (bit 2, x0.5 rpm, bit 0 set so speed is absent)", () => {
    const sample = expectSample(parseIndoorBikeData(view([0x05, 0x00, 0x60, 0x00])));

    expect(sample.speedMps).toBeUndefined();
    expect(sample.cadenceRpm).toBe(48);
  });

  it("parses negative freewheel power (sint16)", () => {
    const sample = expectSample(parseIndoorBikeData(view([0x41, 0x00, 0xf0, 0xff])));

    expect(sample.powerW).toBe(-16);
  });

  it("parses the uint24 total distance", () => {
    const sample = expectSample(parseIndoorBikeData(view([0x11, 0x00, 0x80, 0x96, 0x98])));

    expect(sample.totalDistanceM).toBe(10_000_000);
  });

  it("parses the 5-octet energy block and maps the 0xFFFF sentinel to undefined", () => {
    const sample = expectSample(
      parseIndoorBikeData(view([0x01, 0x01, 0x2c, 0x01, 0x00, 0x00, 0x0a])),
    );

    expect(sample.energyKcal).toBe(300);

    const sentinel = expectSample(
      parseIndoorBikeData(view([0x01, 0x01, 0xff, 0xff, 0x00, 0x00, 0x0a])),
    );

    expect(sentinel.energyKcal).toBeUndefined();
  });
});

describe("parseIndoorBikeData field shifts", () => {
  it("shifts the middle field away when bit 0 is set (no speed)", () => {
    // 0x0045: bits 0, 2, 6 -> no speed, cadence and power move forward.
    const sample = expectSample(parseIndoorBikeData(view([0x45, 0x00, 0x60, 0x00, 0xf4, 0x01])));

    expect(sample.speedMps).toBeUndefined();
    expect(sample.cadenceRpm).toBe(48);
    expect(sample.powerW).toBe(500);
  });

  it("shifts fields back when bit 0 is clear (speed present)", () => {
    // Bits 2 and 6 with bit 0 clear: the first pair becomes speed, then cadence and power.
    const sample = expectSample(
      parseIndoorBikeData(view([0x44, 0x00, 0x60, 0x00, 0x64, 0x00, 0xf4, 0x01])),
    );

    expect(sample.speedMps).toBeCloseTo(0.2667, 3);
    expect(sample.cadenceRpm).toBe(50);
    expect(sample.powerW).toBe(500);
  });

  it("skips average/resistance/met/time fields without shifting the ones it keeps", () => {
    // flags 0x1c67: no speed (bit 0), avg speed (1), cadence (2), resistance (5),
    // power (6), met (10), elapsed (11), remaining (12).
    const bytes = [
      0x67, 0x1c, 0x10, 0x00, 0x64, 0x00, 0x05, 0x00, 0xf4, 0x01, 0x0a, 0x14, 0x00, 0x1e, 0x00,
    ];

    const sample = expectSample(parseIndoorBikeData(view(bytes)));

    expect(sample.speedMps).toBeUndefined();
    expect(sample.cadenceRpm).toBe(50);
    expect(sample.powerW).toBe(500);
    expect(sample.hrBpm).toBeUndefined();
  });
});

describe("parseIndoorBikeData real-world shape", () => {
  it("parses the typical KICKR combination (speed + cadence + power + hr)", () => {
    // The Stack Overflow KICKR frame "44 02 52 03 5A 00 08 00 00".
    const sample = expectSample(
      parseIndoorBikeData(view([0x44, 0x02, 0x52, 0x03, 0x5a, 0x00, 0x08, 0x00, 0x00])),
    );

    expect(sample.speedMps).toBeCloseTo(2.3611, 3);
    expect(sample.cadenceRpm).toBe(45);
    expect(sample.powerW).toBe(8);
    expect(sample.hrBpm).toBe(0);
  });

  it("rejects truncated frames and trailing garbage without throwing", () => {
    expect(parseIndoorBikeData(view([])).ok).toBe(false);
    expect(parseIndoorBikeData(view([0x00])).ok).toBe(false);
    expect(parseIndoorBikeData(view([0x04, 0x00, 0x60])).ok).toBe(false);
    expect(parseIndoorBikeData(view([0x40, 0x00, 0xf4, 0x01, 0x00])).ok).toBe(false);
    expect(parseIndoorBikeData(view([0x10, 0x00, 0x80, 0x96])).ok).toBe(false);
  });
});

describe("parseIndoorBikeData properties", () => {
  it("never throws on arbitrary bytes", () => {
    expect(noThrowPropertyHolds()).toBe(true);
  });

  it("round-trips a cadence+power frame built from arbitrary values", () => {
    expect(roundTripPropertyHolds()).toBe(true);
  });
});
