import { array, assert, integer, option, property, subarray } from "fast-check";
import { expect, it } from "vitest";

import { bytesToDataView } from "./bytes.js";
import { encodeIndoorBikeData } from "./ftms/encode.js";
import {
  encodeFitnessMachineFeature,
  parseFitnessMachineFeature,
  type MachineFeature,
  type TargetSettingFeature,
} from "./ftms/feature.js";
import { parseIndoorBikeData } from "./ftms/parse.js";
import { encodeHeartRateMeasurement } from "./hrs/encode.js";
import { parseHeartRateMeasurement } from "./hrs/parse.js";

/** Listed in bit order, the order the parser reports them. */
const MACHINE: readonly MachineFeature[] = ["cadence", "heartRateMeasurement", "powerMeasurement"];

const TARGETS: readonly TargetSettingFeature[] = [
  "powerTarget",
  "indoorBikeSimulationParameters",
  "cadenceTarget",
];

function scaled(raw: number | undefined, divisor: number): number | undefined {
  return raw === undefined ? undefined : raw / divisor;
}

it("Indoor Bike Data frames round-trip through the production parser", () => {
  assert(
    property(
      option(integer({ min: 0, max: 0xffff }), { nil: undefined }),
      option(integer({ min: 0, max: 0xffff }), { nil: undefined }),
      option(integer({ min: -0x8000, max: 0x7fff }), { nil: undefined }),
      option(integer({ min: 0, max: 0xff }), { nil: undefined }),
      (speedRaw, cadenceRaw, powerW, hrBpm) => {
        const parsed = parseIndoorBikeData(
          bytesToDataView(encodeIndoorBikeData({ speedRaw, cadenceRaw, powerW, hrBpm })),
        );

        expect(parsed).toMatchObject({
          ok: true,
          value: {
            speedMps: scaled(speedRaw, 360),
            cadenceRpm: scaled(cadenceRaw, 2),
            powerW,
            hrBpm,
          },
        });
      },
    ),
  );
});

it("Heart Rate Measurement frames round-trip through the production parser", () => {
  assert(
    property(
      integer({ min: 0, max: 0xffff }),
      option(integer({ min: 0, max: 0xffff }), { nil: undefined }),
      array(integer({ min: 0, max: 0xffff }), { maxLength: 4 }),
      (bpm: number, energyKcal: number | undefined, rrRaw: readonly number[]) => {
        const parsed = parseHeartRateMeasurement(
          bytesToDataView(encodeHeartRateMeasurement({ bpm, energyKcal, rrRaw })),
        );

        expect(parsed).toMatchObject({
          ok: true,
          value: { bpm, energyKcal, rrMs: rrRaw.map((raw) => (raw * 1000) / 1024) },
        });
      },
    ),
  );
});

it("Fitness Machine Feature dwords round-trip through the production parser", () => {
  assert(
    property(
      subarray([...MACHINE]),
      subarray([...TARGETS]),
      (machine: readonly MachineFeature[], targets: readonly TargetSettingFeature[]) => {
        const parsed = parseFitnessMachineFeature(
          bytesToDataView(
            encodeFitnessMachineFeature({ machineFeatures: machine, targetFeatures: targets }),
          ),
        );

        expect(parsed).toMatchObject({
          ok: true,
          value: { machineFeatures: machine, targetFeatures: targets },
        });
      },
    ),
  );
});
