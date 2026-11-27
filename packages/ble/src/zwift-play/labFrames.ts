import { readerBytes, toHex, type ByteReader } from "../bytes.js";
import { isClickV2LockNotice, parseClickV2Input } from "./clickV2.js";
import { RIDE_ON, bytesStartWith } from "./handshake.js";
import { parsePlayInput } from "./parse.js";

/** Lab text for a Zwift data frame on …02: Play `0x07`, Click v2 `0x23` or a lock notice. */
export function describeZwiftFrame(data: ByteReader): string {
  const play = parsePlayInput(data);

  if (play.ok) {
    return JSON.stringify({
      ...play.value,
      analogInfo: "Unkalibrierte Rohwerte, keine Spielwirkung.",
    });
  }

  const click = parseClickV2Input(data);

  if (click.ok) {
    return JSON.stringify({
      clickV2: click.value.pressed.length === 0 ? "keine Taste" : click.value.pressed.join("+"),
      buttonMap: `0x${click.value.buttonMap.toString(16).padStart(8, "0")}`,
    });
  }

  return isClickV2LockNotice(data) ? "Click v2 gesperrt/Unlock-Challenge (Zwift-App nötig)" : "";
}

/** Lab text for a handshake reply on …04: "RideOn" plus any version or key bytes. */
export function describeZwiftResponse(data: ByteReader): string {
  if (!bytesStartWith(data, RIDE_ON)) return "";

  const suffix = readerBytes(data).slice(RIDE_ON.length);

  return suffix.length === 0 ? "RideOn" : `RideOn + ${toHex(suffix)}`;
}
