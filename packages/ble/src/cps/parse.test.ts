import { assert, integer, property, uint8Array } from "fast-check";
import { describe, expect, it } from "vitest";

import { bytesToDataView, type ParseResult, type ReadOnlyBytes } from "../bytes.js";
import { parseCyclingPowerMeasurement, type CyclingPowerSample } from "./parse.js";

function view(bytes: readonly number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

function expectSample(result: ParseResult<CyclingPowerSample>): CyclingPowerSample {
  expect(result.ok).toBe(true);

  if (result.ok) {
    return result.value;
  }

  throw new Error("expected a parsed sample");
}

function noThrowPropertyHolds(): boolean {
  assert(
    property(uint8Array({ minLength: 0, maxLength: 32 }), (bytes: ReadOnlyBytes) => {
      // The property is the absence of a throw; both result variants pass.
      parseCyclingPowerMeasurement(bytesToDataView(bytes));
    }),
  );

  return true;
}

function roundTripPropertyHolds(): boolean {
  assert(
    property(
      integer({ min: -32768, max: 32767 }),
      integer({ min: 0, max: 65535 }),
      integer({ min: 0, max: 65535 }),
      (power: number, revs: number, event: number) => {
        const bytes = [
          0x20,
          0x00,
          power & 0xff,
          power >> 8,
          revs & 0xff,
          revs >> 8,
          event & 0xff,
          event >> 8,
        ];

        const sample = expectSample(parseCyclingPowerMeasurement(view(bytes)));

        expect(sample.powerW).toBe(power);
        expect(sample.crankRevs).toBe(revs);
        expect(sample.crankEventRaw).toBe(event);
      },
    ),
  );

  return true;
}

describe("parseCyclingPowerMeasurement core fields", () => {
  it("parses instantaneous power only (flags 0)", () => {
    const sample = expectSample(parseCyclingPowerMeasurement(view([0x00, 0x00, 0xf4, 0x01])));

    expect(sample.powerW).toBe(500);
    expect(sample.crankRevs).toBeUndefined();
    expect(sample.crankEventRaw).toBeUndefined();
  });

  it("parses power plus crank revolution data (spec example)", () => {
    const sample = expectSample(
      parseCyclingPowerMeasurement(view([0x20, 0x00, 0xf4, 0x01, 0x78, 0x00, 0x00, 0x0a])),
    );

    expect(sample.powerW).toBe(500);
    expect(sample.crankRevs).toBe(120);
    expect(sample.crankEventRaw).toBe(2560);
  });

  it("parses accumulated energy (bit 11)", () => {
    const sample = expectSample(
      parseCyclingPowerMeasurement(view([0x00, 0x08, 0xf4, 0x01, 0x2c, 0x01])),
    );

    expect(sample.accumulatedEnergyKj).toBe(300);
  });
});

describe("parseCyclingPowerMeasurement optional blocks", () => {
  it("consumes the wheel revolution block without decoding it", () => {
    // flags 0x10 (wheel data): 6 octets between power and the frame end.
    const sample = expectSample(
      parseCyclingPowerMeasurement(
        view([0x10, 0x00, 0xf4, 0x01, 0x20, 0x00, 0x00, 0x00, 0x05, 0x00]),
      ),
    );

    expect(sample.powerW).toBe(500);
    expect(sample.crankRevs).toBeUndefined();
  });

  it("keeps balance and torque octets in front of the wheel block", () => {
    // flags 0x11: balance(1) + wheel(6) after power.
    const sample = expectSample(
      parseCyclingPowerMeasurement(
        view([0x11, 0x00, 0xf4, 0x01, 0x30, 0x20, 0x00, 0x00, 0x00, 0x05, 0x00]),
      ),
    );

    expect(sample.powerW).toBe(500);
  });

  it("rejects extreme magnitude flags, truncated frames and trailing bytes", () => {
    expect(parseCyclingPowerMeasurement(view([0x40, 0x00, 0xf4, 0x01])).ok).toBe(false);
    expect(parseCyclingPowerMeasurement(view([])).ok).toBe(false);
    expect(parseCyclingPowerMeasurement(view([0x20, 0x00, 0xf4, 0x01, 0x78])).ok).toBe(false);
    expect(parseCyclingPowerMeasurement(view([0x00, 0x00, 0xf4, 0x01, 0x00])).ok).toBe(false);
  });
});

describe("parseCyclingPowerMeasurement properties", () => {
  it("never throws on arbitrary bytes", () => {
    expect(noThrowPropertyHolds()).toBe(true);
  });

  it("round-trips a power+crank frame built from arbitrary values", () => {
    expect(roundTripPropertyHolds()).toBe(true);
  });
});
