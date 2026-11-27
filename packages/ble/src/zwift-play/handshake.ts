import { readOnlyBytes, type ByteReader, type ReadOnlyBytes } from "../bytes.js";

/** Cleartext Zwift Play handshake "RideOn" (docs/02-bluetooth.md section 4). */
export const RIDE_ON = readOnlyBytes(Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]));

// UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2
/** Click v2 / Ride handshake "RideOn" + 02 03; the reply starts with the same eight bytes. */
export const RIDE_ON_CLICK_V2 = readOnlyBytes(
  Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e, 0x02, 0x03]),
);

export function bytesStartWith(data: ByteReader, prefix: ReadOnlyBytes): boolean {
  if (data.byteLength < prefix.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (data.getUint8(index) !== prefix.at(index)) {
      return false;
    }
  }

  return true;
}

/**
 * A long reply that is not the Click v2 cleartext reply carries a device key: the
 * encrypted handshake (docs/02-bluetooth.md#handshake), which stays unimplemented.
 */
// UNVERIFIED: docs/02-bluetooth.md#handshake
export function isEncryptedHandshakeReply(data: ByteReader): boolean {
  return data.byteLength >= 64 && !bytesStartWith(data, RIDE_ON_CLICK_V2);
}
