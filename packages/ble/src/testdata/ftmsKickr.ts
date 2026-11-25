/**
 * Synthetic FTMS fixture in KICKR shape: flags 0x0244 (speed + cadence + power
 * + heart rate) at 1 Hz, a 0x2ACC feature read response and the marked Sim
 * writes from the session protocol. The trainer adapter replay test must emit
 * the expected trainer.data sequence from it.
 */

import { toHex } from "../bytes.js";
import { encodeIndoorBikeData } from "../ftms/encode.js";
import type { BleFixture, BleLogEntry } from "../fixtureSchema.js";
import type { DeviceEvent } from "@voltonaut/shared";

export interface FtmsScriptSample {
  readonly speedRaw: number;
  readonly cadenceRaw: number;
  readonly powerW: number;
  readonly hrBpm: number;
}

const SCRIPT: readonly FtmsScriptSample[] = [
  { speedRaw: 850, cadenceRaw: 90, powerW: 142, hrBpm: 122 },
  { speedRaw: 940, cadenceRaw: 94, powerW: 176, hrBpm: 128 },
  { speedRaw: 1050, cadenceRaw: 99, powerW: 205, hrBpm: 134 },
  { speedRaw: 960, cadenceRaw: 91, powerW: 168, hrBpm: 130 },
  { speedRaw: 800, cadenceRaw: 80, powerW: -16, hrBpm: 129 },
];

/** The 5.00 % grade command from the sniffer preset, as a recorded tx entry. */
const SIM_FIVE_TX: BleLogEntry = {
  kind: "data",
  tMs: 600_000,
  device: "KICKR CORE synth",
  service: "0x1826",
  char: "0x2AD9",
  dir: "tx",
  hex: "11 00 00 f4 01 28 33",
  ascii: "",
  decoded: "",
  marker: "Sim 5 % gesetzt",
};

const FEATURE_READ: BleLogEntry = {
  kind: "data",
  tMs: 250,
  device: "KICKR CORE synth",
  service: "0x1826",
  char: "0x2ACC",
  dir: "rx",
  hex: "2b 14 00 00 08 20 00 00",
  ascii: "",
  decoded: "machine 0x0000142b, targets power+sim",
  marker: "",
};

export interface FtmsSyntheticData {
  readonly fixture: BleFixture;
  /** The trainer.data events the adapter must emit from this fixture. */
  readonly expectedEvents: readonly DeviceEvent[];
}

const META: BleFixture["meta"] = {
  schemaVersion: 1,
  ua: "vitest-synthetic",
  date: "2026-11-20T10:00:00.000Z",
  deviceName: "KICKR CORE synth",
  deviceId: "synth-kickr-0001",
  firmware: "",
  protocol: "ftms",
  notes: "synthetic KICKR-shaped fixture, flags 0x0244",
};

const GATT: BleFixture["gatt"] = [
  {
    service: "0x1826",
    characteristics: [
      { char: "0x2ACC", properties: ["read"], descriptors: [] },
      { char: "0x2AD2", properties: ["notify"], descriptors: [] },
      { char: "0x2AD9", properties: ["write", "indicate"], descriptors: [] },
    ],
  },
];

export function createFtmsSyntheticFixture(): FtmsSyntheticData {
  const samples: FtmsScriptSample[] = [];

  for (let second = 0; second < 120; second += 1) {
    samples.push(
      SCRIPT[second % SCRIPT.length] ?? { speedRaw: 850, cadenceRaw: 90, powerW: 142, hrBpm: 122 },
    );
  }

  const log: BleLogEntry[] = [
    FEATURE_READ,
    ...samples.map((sample, index) => {
      const bytes = encodeIndoorBikeData(sample);

      return {
        kind: "data",
        tMs: (index + 1) * 1000,
        device: "KICKR CORE synth",
        service: "0x1826",
        char: "0x2AD2",
        dir: "rx",
        hex: toHex(bytes),
        ascii: "",
        decoded: "",
        marker: "",
      } satisfies BleLogEntry;
    }),
    SIM_FIVE_TX,
  ];

  const expectedEvents: DeviceEvent[] = samples.map((sample, index) => ({
    type: "trainer.data",
    tS: index + 1,
    powerW: sample.powerW,
    cadenceRpm: sample.cadenceRaw * 0.5,
    speedMps: sample.speedRaw / 360,
  }));

  return {
    fixture: {
      meta: META,
      gatt: GATT,
      log,
    },
    expectedEvents,
  };
}
