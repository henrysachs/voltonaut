import { array, assert, integer, property, uint8Array } from "fast-check";
import { describe, expect, it } from "vitest";

import { bytesToDataView, type ParseResult, type ReadOnlyBytes } from "../bytes.js";
import { parseHeartRateMeasurement, type HeartRateSample } from "./parse.js";

function view(bytes: readonly number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

function expectSample(result: ParseResult<HeartRateSample>): HeartRateSample {
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
      parseHeartRateMeasurement(bytesToDataView(bytes));
    }),
  );

  return true;
}

function roundTripPropertyHolds(): boolean {
  assert(
    property(
      integer({ min: 0, max: 255 }),
      integer({ min: 0, max: 65535 }),
      array(integer({ min: 0, max: 65535 }), { maxLength: 8 }),
      (bpm: number, energy: number, rr: readonly number[]) => {
        const bytes = [0x18, bpm, energy & 0xff, energy >> 8];

        for (const raw of rr) {
          bytes.push(raw & 0xff, raw >> 8);
        }

        const sample = expectSample(parseHeartRateMeasurement(view(bytes)));

        expect(sample.bpm).toBe(bpm);
        expect(sample.energyKcal).toBe(energy);
        expect(sample.rrMs).toHaveLength(rr.length);
      },
    ),
  );

  return true;
}

describe("parseHeartRateMeasurement heart rate fields", () => {
  it("parses uint8 heart rate", () => {
    const sample = expectSample(parseHeartRateMeasurement(view([0x00, 0x40])));

    expect(sample.bpm).toBe(64);
    expect(sample.contact).toBe("notSupported");
    expect(sample.energyKcal).toBeUndefined();
    expect(sample.rrMs).toEqual([]);
  });

  it("parses uint16 little-endian heart rate", () => {
    const sample = expectSample(parseHeartRateMeasurement(view([0x01, 0x96, 0x00])));

    expect(sample.bpm).toBe(150);
  });

  it("decodes sensor contact bits", () => {
    expect(expectSample(parseHeartRateMeasurement(view([0x04, 0x40]))).contact).toBe("noContact");
    expect(expectSample(parseHeartRateMeasurement(view([0x06, 0x40]))).contact).toBe("contact");
    expect(expectSample(parseHeartRateMeasurement(view([0x02, 0x40]))).contact).toBe(
      "notSupported",
    );
  });
});

describe("parseHeartRateMeasurement optional fields", () => {
  it("parses energy and rr intervals from the spec example", () => {
    const sample = expectSample(
      parseHeartRateMeasurement(view([0x18, 0x64, 0x2c, 0x01, 0x68, 0x0d])),
    );

    expect(sample.bpm).toBe(100);
    expect(sample.energyKcal).toBe(300);
    expect(sample.rrMs).toHaveLength(1);
    // 0x0d68 = 3432 raw; 3432 / 1024 s in ms. The spec text prints 3340.6, the bytes win.
    expect(sample.rrMs[0]).toBe(3351.5625);
  });

  it("parses several rr intervals", () => {
    const sample = expectSample(
      parseHeartRateMeasurement(view([0x10, 0x50, 0x00, 0x02, 0x02, 0x00])),
    );

    expect(sample.bpm).toBe(80);
    expect(sample.rrMs).toHaveLength(2);
    expect(sample.rrMs[0]).toBe(500);
    expect(sample.rrMs[1]).toBeCloseTo(1.953, 3);
  });

  it("rejects truncated inputs without throwing", () => {
    expect(parseHeartRateMeasurement(view([])).ok).toBe(false);
    expect(parseHeartRateMeasurement(view([0x00])).ok).toBe(false);
    expect(parseHeartRateMeasurement(view([0x01, 0x96])).ok).toBe(false);
    expect(parseHeartRateMeasurement(view([0x08, 0x40])).ok).toBe(false);
    expect(parseHeartRateMeasurement(view([0x10, 0x40, 0x00, 0x00, 0x05])).ok).toBe(false);
    expect(parseHeartRateMeasurement(view([0x00, 0x40, 0x00])).ok).toBe(false);
  });
});

describe("parseHeartRateMeasurement properties", () => {
  it("never throws on arbitrary bytes and always yields a result object", () => {
    expect(noThrowPropertyHolds()).toBe(true);
  });

  it("round-trips an encoded uint8 frame with energy and rr intervals", () => {
    expect(roundTripPropertyHolds()).toBe(true);
  });
});
