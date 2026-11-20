/**
 * Synthetic heart-rate fixture built from the spec byte examples: a 60 s chest
 * strap log at 1 Hz. Frames alternate flag shapes (uint8/uint16 HR, RR lists,
 * energy) so the replay test exercises every parser path. Real captures will
 * replace this after the hardware session (fixtures/ble/, protected).
 */

import { toHex } from "../bytes.js";
import type { BleFixture, BleLogEntry } from "../fixtureSchema.js";
import type { DeviceEvent } from "@voltonaut/shared";

export interface HrsScriptSample {
  readonly bpm: number;
  readonly energyKcal?: number;
  readonly rrRaw?: readonly number[];
}

function encodeFrame(sample: HrsScriptSample): Uint8Array {
  const usesUint16 = sample.bpm > 0xff;

  const flags =
    (usesUint16 ? 0x01 : 0x00) |
    (sample.energyKcal === undefined ? 0x00 : 0x08) |
    (sample.rrRaw !== undefined && sample.rrRaw.length > 0 ? 0x10 : 0x00);

  const bytes = usesUint16
    ? [flags, sample.bpm & 0xff, sample.bpm >> 8]
    : [flags, sample.bpm & 0xff];

  if (sample.energyKcal !== undefined) {
    bytes.push(sample.energyKcal & 0xff, sample.energyKcal >> 8);
  }

  for (const raw of sample.rrRaw ?? []) {
    bytes.push(raw & 0xff, raw >> 8);
  }

  return Uint8Array.from(bytes);
}

const SCRIPT: readonly HrsScriptSample[] = [
  { bpm: 64 },
  { bpm: 122 },
  { bpm: 150 },
  { bpm: 128, rrRaw: [512, 500] },
  { bpm: 134 },
  { bpm: 100, energyKcal: 300, rrRaw: [3432] },
  { bpm: 130, rrRaw: [500] },
  { bpm: 118 },
  { bpm: 126, rrRaw: [498, 512] },
  { bpm: 140, energyKcal: 302, rrRaw: [460] },
];

/** 60 samples: the script repeated six times, one per second. */
function strapSamples(): readonly HrsScriptSample[] {
  const samples: HrsScriptSample[] = [];

  for (let second = 0; second < 60; second += 1) {
    samples.push(SCRIPT[second % SCRIPT.length] ?? SCRIPT[0] ?? { bpm: 60 });
  }

  return samples;
}

export interface HrsSyntheticData {
  readonly fixture: BleFixture;
  /** The hr.data events the adapter must emit from this fixture. */
  readonly expectedEvents: readonly DeviceEvent[];
}

const META: BleFixture["meta"] = {
  schemaVersion: 1,
  ua: "vitest-synthetic",
  date: "2026-11-20T10:00:00.000Z",
  deviceName: "Chest Strap synth",
  deviceId: "synth-strap-0001",
  firmware: "",
  protocol: "hrs",
  notes: "synthetic fixture built from the E1 spec byte examples",
};

export function createHrsSyntheticFixture(): HrsSyntheticData {
  const samples = strapSamples();

  const log: BleLogEntry[] = samples.map((sample, index) => {
    const bytes = encodeFrame(sample);

    return {
      kind: "data",
      tMs: (index + 1) * 1000,
      device: "Chest Strap synth",
      service: "0x180D",
      char: "0x2A37",
      dir: "rx",
      hex: toHex(bytes),
      ascii: "",
      decoded: "",
      marker: "",
    };
  });

  const expectedEvents: DeviceEvent[] = samples.map((sample, index) => {
    const tS = index + 1;

    return sample.rrRaw !== undefined && sample.rrRaw.length > 0
      ? {
          type: "hr.data",
          tS,
          bpm: sample.bpm,
          rrMs: sample.rrRaw.map((raw) => (raw * 1000) / 1024),
        }
      : { type: "hr.data", tS, bpm: sample.bpm };
  });

  return {
    fixture: {
      meta: META,
      gatt: [
        {
          service: "0x180D",
          characteristics: [{ char: "0x2A37", properties: ["notify"], descriptors: [] }],
        },
      ],
      log,
    },
    expectedEvents,
  };
}
