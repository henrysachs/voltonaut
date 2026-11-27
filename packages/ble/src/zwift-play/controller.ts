import { parseFailure, type ByteReader, type ParseResult, type ReadOnlyBytes } from "../bytes.js";
import type { GattProfile, ScanOptions } from "../transport.js";
import {
  BATTERY_SERVICE,
  CYCLING_POWER_SERVICE,
  DEVICE_INFORMATION_SERVICE,
  FITNESS_MACHINE_SERVICE,
  ZWIFT_PLAY_COMMAND_RESPONSE,
  ZWIFT_PLAY_CONTROL_POINT,
  ZWIFT_PLAY_LEGACY_SERVICE,
  ZWIFT_PLAY_MEASUREMENT,
  ZWIFT_PLAY_V2_SERVICE,
} from "../uuids.js";
import { RIDE_ON, RIDE_ON_CLICK_V2, bytesStartWith } from "./handshake.js";

/** `play`: Zwift Play grips with `0x07` frames; `clickV2`: Zwift Click v2 pucks with `0x23` frames. */
export type ZwiftControllerFamily = "play" | "clickV2";

export interface ZwiftControllerLink {
  readonly family: ZwiftControllerFamily;
  readonly serviceUuid: string;
  readonly handshake: ReadOnlyBytes;
}

const REQUIRED = [
  { uuid: ZWIFT_PLAY_MEASUREMENT, property: "notify" },
  { uuid: ZWIFT_PLAY_COMMAND_RESPONSE, property: "indicate" },
  { uuid: ZWIFT_PLAY_CONTROL_POINT, property: "writeWithoutResponse" },
] as const;

function offers(profile: GattProfile, serviceUuid: string): boolean {
  const service = profile.services.find((item) => item.uuid === serviceUuid);

  return REQUIRED.every(
    (required) =>
      service?.characteristics.some(
        (item) =>
          item.uuid === required.uuid &&
          item.properties.some((property) => property === required.property),
      ) === true,
  );
}

/**
 * Picks the controller protocol from the GATT profile. Trainers such as the Zwift Hub
 * also expose the proprietary `00000001-19ca-…` service; it is deliberately never used
 * (ADR-001), so any device with FTMS or CPS is refused here.
 */
export function zwiftControllerLink(profile: GattProfile): ParseResult<ZwiftControllerLink> {
  if (
    profile.services.some(
      (service) =>
        service.uuid === FITNESS_MACHINE_SERVICE || service.uuid === CYCLING_POWER_SERVICE,
    )
  ) {
    return parseFailure("Das ist ein Trainer, kein Controller. Im Trainer-Slot verbinden.");
  }

  // UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2
  if (offers(profile, ZWIFT_PLAY_V2_SERVICE)) {
    return {
      ok: true,
      value: { family: "clickV2", serviceUuid: ZWIFT_PLAY_V2_SERVICE, handshake: RIDE_ON_CLICK_V2 },
    };
  }

  if (offers(profile, ZWIFT_PLAY_LEGACY_SERVICE)) {
    return {
      ok: true,
      value: { family: "play", serviceUuid: ZWIFT_PLAY_LEGACY_SERVICE, handshake: RIDE_ON },
    };
  }

  return parseFailure(
    "Kein unterstützter Zwift-Controller mit Notify/Indicate/writeWithoutResponse. Anderes Gerät wählen.",
  );
}

// UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2 – whether Click v2 advertises fc82 is unknown, hence the name filter.
// The trainer services are requested only so that a Zwift Hub, which also offers the
// proprietary Zwift service, is recognized and refused in a controller slot.
export const CONTROLLER_SCAN: ScanOptions = {
  acceptAllDevices: false,
  filters: [
    { services: [ZWIFT_PLAY_LEGACY_SERVICE] },
    { services: [ZWIFT_PLAY_V2_SERVICE] },
    { namePrefix: "Zwift Click" },
  ],
  optionalServices: [
    ZWIFT_PLAY_LEGACY_SERVICE,
    ZWIFT_PLAY_V2_SERVICE,
    BATTERY_SERVICE,
    DEVICE_INFORMATION_SERVICE,
    FITNESS_MACHINE_SERVICE,
    CYCLING_POWER_SERVICE,
  ],
};

/** Play answers exactly "RideOn"; Click v2 appends a device key after "RideOn 02 03". */
export function acceptsHandshakeReply(link: ZwiftControllerLink, data: ByteReader): boolean {
  return link.family === "clickV2"
    ? bytesStartWith(data, link.handshake)
    : data.byteLength === link.handshake.length && bytesStartWith(data, link.handshake);
}
