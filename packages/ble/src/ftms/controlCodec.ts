import type { TrainerCommand } from "@voltonaut/shared";
import {
  parseFailure,
  readOnlyBytes,
  type ByteReader,
  type ParseResult,
  type ReadOnlyBytes,
} from "../bytes.js";

export type SimulationCommand = Extract<TrainerCommand, { readonly type: "simulation" }>;

export type ControlResult = "success" | "notSupported" | "invalidParam" | "failed" | "notPermitted";

export interface EncodedSimulation {
  readonly command: SimulationCommand;
  readonly bytes: ReadOnlyBytes;
}

export const NEUTRAL_SIMULATION: EncodedSimulation = {
  command: { type: "simulation", gradePct: 0, windMps: 0, crr: 0, cwKgPerM: 0 },
  bytes: readOnlyBytes(Uint8Array.of(0x11, 0, 0, 0, 0, 0, 0)),
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** FTMS v1.0 §4.16.2.18. Transport limits are deliberately below the engine's limits. */
export function encodeSimulation(command: SimulationCommand): ParseResult<EncodedSimulation> {
  const finite = [command.gradePct, command.windMps, command.crr, command.cwKgPerM].every((value) =>
    Number.isFinite(value),
  );

  if (!finite || command.crr < 0 || command.cwKgPerM < 0) {
    return parseFailure("invalid simulation parameters");
  }

  const wind = Math.round(clamp(command.windMps * 1000, -32768, 32767));
  const grade = Math.round(clamp(command.gradePct, -5, 10) * 100);
  const crr = Math.round(clamp(command.crr * 10000, 0, 255));
  const cw = Math.round(clamp(command.cwKgPerM * 100, 0, 255));
  const bytes = new Uint8Array(7);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 0x11);
  view.setInt16(1, wind, true);
  view.setInt16(3, grade, true);
  view.setUint8(5, crr);
  view.setUint8(6, cw);

  return {
    ok: true,
    value: {
      bytes: readOnlyBytes(bytes),
      command: {
        type: "simulation",
        windMps: wind / 1000,
        gradePct: grade / 100,
        crr: crr / 10000,
        cwKgPerM: cw / 100,
      },
    },
  };
}

export function parseControlResponse(data: ByteReader): ParseResult<{
  readonly opcode: number;
  readonly result: ControlResult;
}> {
  if (data.byteLength !== 3 || data.getUint8(0) !== 0x80) {
    return parseFailure("expected exact FTMS response code");
  }

  const result = [
    "success",
    "notSupported",
    "invalidParam",
    "failed",
    "notPermitted",
  ] satisfies readonly ControlResult[];

  const decoded = result[data.getUint8(2) - 1];

  return decoded === undefined
    ? parseFailure("unknown FTMS result")
    : { ok: true, value: { opcode: data.getUint8(1), result: decoded } };
}
