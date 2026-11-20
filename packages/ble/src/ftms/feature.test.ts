import { assert, property, uint8Array } from "fast-check";
import { describe, expect, it } from "vitest";

import { bytesToDataView, type ParseResult, type ReadOnlyBytes } from "../bytes.js";
import { parseFitnessMachineFeature, type FitnessMachineFeature } from "./feature.js";

function view(bytes: readonly number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

function expectFeature(result: ParseResult<FitnessMachineFeature>): FitnessMachineFeature {
  expect(result.ok).toBe(true);

  if (result.ok) {
    return result.value;
  }

  throw new Error("expected a parsed feature");
}

function noThrowPropertyHolds(): boolean {
  assert(
    property(uint8Array({ minLength: 0, maxLength: 16 }), (bytes: ReadOnlyBytes) => {
      // The property is the absence of a throw; both result variants pass.
      parseFitnessMachineFeature(bytesToDataView(bytes));
    }),
  );

  return true;
}

describe("parseFitnessMachineFeature target dword", () => {
  it("decodes the spec example: target dword 0x00002008 is power target + sim parameters", () => {
    const feature = expectFeature(
      parseFitnessMachineFeature(view([0x00, 0x00, 0x00, 0x00, 0x08, 0x20, 0x00, 0x00])),
    );

    expect(feature.machineFeatures).toEqual([]);
    expect(feature.targetFeatures).toEqual(["powerTarget", "indoorBikeSimulationParameters"]);
  });

  it("decodes wheel circumference and spin down next to the target bits", () => {
    const feature = expectFeature(
      parseFitnessMachineFeature(view([0x00, 0x00, 0x00, 0x00, 0x08, 0xe0, 0x00, 0x00])),
    );

    expect(feature.targetFeatures).toEqual([
      "powerTarget",
      "indoorBikeSimulationParameters",
      "wheelCircumference",
      "spinDownControl",
    ]);
  });
});

describe("parseFitnessMachineFeature machine dword", () => {
  it("keeps the raw machine dword as hex for the session log", () => {
    const feature = expectFeature(
      parseFitnessMachineFeature(view([0x2b, 0x14, 0x00, 0x00, 0x08, 0x20, 0x00, 0x00])),
    );

    expect(feature.machineDwordHex).toBe("0x0000142b");
    expect(feature.machineFeatures).toEqual([
      "averageSpeed",
      "cadence",
      "inclination",
      "pace",
      "heartRateMeasurement",
      "elapsedTime",
    ]);
  });

  it("rejects the known misread (2 octets instead of 8) without throwing", () => {
    expect(parseFitnessMachineFeature(view([0x08, 0x20])).ok).toBe(false);
    expect(parseFitnessMachineFeature(view([])).ok).toBe(false);
  });
});

describe("parseFitnessMachineFeature properties", () => {
  it("never throws on arbitrary bytes", () => {
    expect(noThrowPropertyHolds()).toBe(true);
  });
});
