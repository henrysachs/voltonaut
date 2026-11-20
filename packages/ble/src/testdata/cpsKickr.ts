/**
 * Synthetic Cycling Power fixture: 0x2A63 frames with crank revolution data
 * whose deltas are a constant 120 rpm, plus the wheel-data block on some
 * frames to prove it is consumed, not decoded. Cadence comes from the
 * stateful CpsTrainerSession, so the expected sequence contains power only
 * on the first frame and power+cadence afterwards.
 */

import { toHex } from "../bytes.js";
import type { BleFixture, BleLogEntry } from "../fixtureSchema.js";
import type { DeviceEvent } from "@voltonaut/shared";

export interface CpsScriptSample {
  readonly powerW: number;
  readonly crankRevs: number;
  readonly crankEventRaw: number;
  readonly withWheelData: boolean;
}

function encodeFrame(sample: CpsScriptSample): Uint8Array {
  const flags = 0x20 | (sample.withWheelData ? 0x10 : 0x00);

  const bytes = [flags, 0x00, sample.powerW & 0xff, sample.powerW >> 8];

  if (sample.withWheelData) {
    bytes.push(0x20, 0x00, 0x00, 0x00, 0x00, 0x10);
  }

  bytes.push(
    sample.crankRevs & 0xff,
    sample.crankRevs >> 8,
    sample.crankEventRaw & 0xff,
    sample.crankEventRaw >> 8,
  );

  return Uint8Array.from(bytes);
}

const FIRST: CpsScriptSample = {
  powerW: 210,
  crankRevs: 120,
  crankEventRaw: 2560,
  withWheelData: false,
};

function cpsSamples(): readonly CpsScriptSample[] {
  const samples: CpsScriptSample[] = [FIRST];

  for (let frame = 1; frame < 30; frame += 1) {
    samples.push({
      powerW: 210 + (frame % 5) * 12,
      crankRevs: 120 + frame,
      crankEventRaw: 2560 + frame * 512,
      withWheelData: frame % 3 === 0,
    });
  }

  return samples;
}

export interface CpsSyntheticData {
  readonly fixture: BleFixture;
  /** The trainer.data events the CPS adapter must emit from this fixture. */
  readonly expectedEvents: readonly DeviceEvent[];
}

export function createCpsSyntheticFixture(): CpsSyntheticData {
  const samples = cpsSamples();

  const log: BleLogEntry[] = samples.map((sample, index) => ({
    kind: "data",
    tMs: (index + 1) * 1000,
    device: "KICKR CORE synth cps",
    service: "0x1818",
    char: "0x2A63",
    dir: "rx",
    hex: toHex(encodeFrame(sample)),
    ascii: "",
    decoded: "",
    marker: "",
  }));

  const expectedEvents: DeviceEvent[] = samples.map((sample, index) =>
    index === 0
      ? { type: "trainer.data", tS: index + 1, powerW: sample.powerW }
      : {
          type: "trainer.data",
          tS: index + 1,
          powerW: sample.powerW,
          cadenceRpm: 120,
        },
  );

  return {
    fixture: {
      meta: {
        schemaVersion: 1,
        ua: "vitest-synthetic",
        date: "2026-11-20T10:00:00.000Z",
        deviceName: "KICKR CORE synth cps",
        deviceId: "synth-cps-0001",
        firmware: "",
        protocol: "cps",
        notes: "synthetic cycling power fixture with crank deltas",
      },
      gatt: [
        {
          service: "0x1818",
          characteristics: [{ char: "0x2A63", properties: ["notify"], descriptors: [] }],
        },
      ],
      log,
    },
    expectedEvents,
  };
}
