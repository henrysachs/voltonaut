/**
 * Fitness Machine Feature 0x2ACC (Fitness Machine Service 0x1826).
 * Eight octets: machine-features dword (LE, bytes 0-3) then target-features
 * dword (LE, bytes 4-7). Bit meanings verified against the FTMS v1.0 PDF
 * (tables 4.3 and 4.4, 2026-11-20).
 */

import { parseFailure, type ByteReader, type ParseResult } from "../bytes.js";

export type MachineFeature =
  | "averageSpeed"
  | "cadence"
  | "totalDistance"
  | "inclination"
  | "elevationGain"
  | "pace"
  | "stepCount"
  | "resistanceLevel"
  | "strideCount"
  | "expendedEnergy"
  | "heartRateMeasurement"
  | "metabolicEquivalent"
  | "elapsedTime"
  | "remainingTime"
  | "powerMeasurement"
  | "forceOnBeltAndPowerOutput"
  | "userDataRetention";

export type TargetSettingFeature =
  | "speedTarget"
  | "inclinationTarget"
  | "resistanceTarget"
  | "powerTarget"
  | "heartRateTarget"
  | "expendedEnergyTarget"
  | "stepNumberTarget"
  | "strideNumberTarget"
  | "distanceTarget"
  | "trainingTimeTarget"
  | "timeInTwoHeartRateZones"
  | "timeInThreeHeartRateZones"
  | "timeInFiveHeartRateZones"
  | "indoorBikeSimulationParameters"
  | "wheelCircumference"
  | "spinDownControl"
  | "cadenceTarget";

export interface FitnessMachineFeature {
  /** Raw machine dword for the E1 session log, e.g. "0x0000142b". */
  readonly machineDwordHex: string;
  readonly machineFeatures: readonly MachineFeature[];
  readonly targetFeatures: readonly TargetSettingFeature[];
}

const MACHINE_FEATURE_BITS: readonly (readonly [number, MachineFeature])[] = [
  [0, "averageSpeed"],
  [1, "cadence"],
  [2, "totalDistance"],
  [3, "inclination"],
  [4, "elevationGain"],
  [5, "pace"],
  [6, "stepCount"],
  [7, "resistanceLevel"],
  [8, "strideCount"],
  [9, "expendedEnergy"],
  [10, "heartRateMeasurement"],
  [11, "metabolicEquivalent"],
  [12, "elapsedTime"],
  [13, "remainingTime"],
  [14, "powerMeasurement"],
  [15, "forceOnBeltAndPowerOutput"],
  [16, "userDataRetention"],
];

const TARGET_FEATURE_BITS: readonly (readonly [number, TargetSettingFeature])[] = [
  [0, "speedTarget"],
  [1, "inclinationTarget"],
  [2, "resistanceTarget"],
  [3, "powerTarget"],
  [4, "heartRateTarget"],
  [5, "expendedEnergyTarget"],
  [6, "stepNumberTarget"],
  [7, "strideNumberTarget"],
  [8, "distanceTarget"],
  [9, "trainingTimeTarget"],
  [10, "timeInTwoHeartRateZones"],
  [11, "timeInThreeHeartRateZones"],
  [12, "timeInFiveHeartRateZones"],
  [13, "indoorBikeSimulationParameters"],
  [14, "wheelCircumference"],
  [15, "spinDownControl"],
  [16, "cadenceTarget"],
];

function decodeBits<TName extends string>(
  dword: number,
  table: readonly (readonly [number, TName])[],
): readonly TName[] {
  const names: TName[] = [];

  for (const [bit, name] of table) {
    if ((dword & (1 << bit)) !== 0) {
      names.push(name);
    }
  }

  return names;
}

function dwordHex(dword: number): string {
  return `0x${dword.toString(16).padStart(8, "0")}`;
}

/** Pure parse; never throws, shorter than 8 octets yields a failure object. */
export function parseFitnessMachineFeature(view: ByteReader): ParseResult<FitnessMachineFeature> {
  if (view.byteLength < 8) {
    return parseFailure("fitness machine feature needs 8 octets (two uint32)");
  }

  const machineDword = view.getUint32(0, true);
  const targetDword = view.getUint32(4, true);

  return {
    ok: true,
    value: {
      machineDwordHex: dwordHex(machineDword),
      machineFeatures: decodeBits(machineDword, MACHINE_FEATURE_BITS),
      targetFeatures: decodeBits(targetDword, TARGET_FEATURE_BITS),
    },
  };
}
