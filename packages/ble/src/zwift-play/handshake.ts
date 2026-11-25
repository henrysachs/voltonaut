import { readOnlyBytes } from "../bytes.js";

/** Cleartext Zwift Play handshake "RideOn" (docs/02-bluetooth.md section 4). */
export const RIDE_ON = readOnlyBytes(Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]));
