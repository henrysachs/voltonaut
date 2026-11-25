import type { ReadOnlyBytes } from "../bytes.js";
import { readOnlyBytes } from "../bytes.js";
import type { CharacteristicRef } from "../transport.js";
import {
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
} from "../uuids.js";
import { RIDE_ON } from "../zwift-play/handshake.js";

/** One FTMS control-point procedure: the write and the opcode its indication must echo. */
export interface FtmsPresetCommand {
  readonly opcode: number;
  readonly bytes: ReadOnlyBytes;
}

/**
 * FTMS presets never carry raw control-point writes; `createFtmsLabControl` runs their
 * commands through `ControlProcedure`. The Play handshake awaits no response, so it
 * stays a plain "observe, then write" description.
 */
export type BlePreset =
  | {
      readonly kind: "ftms";
      readonly id: string;
      readonly label: string;
      /** `acquire` requests control on this connection; `granted` requires a prior acquire. */
      readonly authority: "acquire" | "granted";
      readonly commands: readonly FtmsPresetCommand[];
    }
  | {
      readonly kind: "zwiftPlay";
      readonly id: string;
      readonly label: string;
      readonly observe: readonly CharacteristicRef[];
      readonly write: { readonly ref: CharacteristicRef; readonly bytes: ReadOnlyBytes };
    };

export type FtmsPreset = Extract<BlePreset, { readonly kind: "ftms" }>;

function command(bytes: readonly number[]): FtmsPresetCommand {
  return { opcode: bytes[0] ?? -1, bytes: readOnlyBytes(Uint8Array.from(bytes)) };
}

/** Request Control `00`, Start `07`, then Set Indoor Bike Simulation 0 %; same order as the ride. */
export const FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET: FtmsPreset = {
  kind: "ftms",
  id: "ftms-request-control-sim-zero",
  label: "FTMS Request Control + Start + Sim 0 %",
  authority: "acquire",
  commands: [command([0x00]), command([0x07]), command([0x11, 0x00, 0x00, 0x00, 0x00, 0x28, 0x33])],
};

/** Set Indoor Bike Simulation 5 %; requires a prior successful Request Control. */
export const FTMS_SIM_FIVE_PRESET: FtmsPreset = {
  kind: "ftms",
  id: "ftms-sim-five",
  label: "FTMS Sim 5 %",
  authority: "granted",
  commands: [command([0x11, 0x00, 0x00, 0xf4, 0x01, 0x28, 0x33])],
};

/**
 * Zwift Play handshake: subscribe 0x...02 and 0x...04, write the cleartext
 * "RideOn" to 0x...03. A 64-byte answer means the encrypted path; the sniffer
 * documents it instead of continuing (docs/02-bluetooth.md section 4).
 */
export const ZWIFT_PLAY_HANDSHAKE_PRESET: BlePreset = {
  kind: "zwiftPlay",
  id: "zwift-play-handshake",
  label: "Zwift-Controller-Handshake",
  observe: [
    { serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE, characteristicUuid: ZWIFT_PLAY_MEASUREMENT },
    { serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE, characteristicUuid: ZWIFT_PLAY_COMMAND_RESPONSE },
  ],
  write: {
    ref: { serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE, characteristicUuid: ZWIFT_PLAY_CONTROL_POINT },
    bytes: RIDE_ON,
  },
};

export const SNIFFER_PRESETS: readonly BlePreset[] = [
  FTMS_REQUEST_CONTROL_AND_SIM_ZERO_PRESET,
  FTMS_SIM_FIVE_PRESET,
  ZWIFT_PLAY_HANDSHAKE_PRESET,
];
