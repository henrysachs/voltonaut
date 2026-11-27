import { parseFailure, type ByteReader, type ParseResult } from "../bytes.js";
import type { PlaySide } from "./parse.js";
import { zwiftProtobufCursor, type ZwiftProtobufCursor } from "./protobuf.js";

export type ClickV2Button =
  | "left"
  | "up"
  | "right"
  | "down"
  | "minus"
  | "a"
  | "b"
  | "y"
  | "z"
  | "plus";

export interface ClickV2Input {
  /** Raw inverted bitmap: a cleared bit is a pressed button. */
  readonly buttonMap: number;
  readonly pressed: readonly ClickV2Button[];
}

// UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2
const BUTTON_BITS: readonly (readonly [ClickV2Button, number, PlaySide])[] = [
  ["left", 0x0001, "left"],
  ["up", 0x0002, "left"],
  ["right", 0x0004, "left"],
  ["down", 0x0008, "left"],
  ["minus", 0x0100, "left"],
  ["a", 0x0010, "right"],
  ["b", 0x0020, "right"],
  ["y", 0x0040, "right"],
  ["z", 0x0080, "right"],
  ["plus", 0x1000, "right"],
];

const BUTTON_MAP_FIELD = 1;
const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

/** The puck that carries `button`: the left puck has −, the right puck has +. */
export function clickV2Side(button: ClickV2Button): PlaySide {
  return BUTTON_BITS.find(([name]) => name === button)?.[2] ?? "right";
}

/** Outcome of reading one protobuf field of a `0x23` frame. */
type FieldStep =
  | { readonly kind: "buttonMap"; readonly value: number }
  | { readonly kind: "skipped" }
  | { readonly kind: "invalid"; readonly reason: string };

function nextField(reader: ZwiftProtobufCursor): FieldStep {
  const tag = reader.varint();

  if (tag === undefined || tag < 8)
    return { kind: "invalid", reason: "invalid Click v2 field tag" };

  const wire = tag % 8;

  if (wire === WIRE_LENGTH_DELIMITED) {
    const length = reader.varint();

    return length !== undefined && reader.skip(length)
      ? { kind: "skipped" }
      : { kind: "invalid", reason: "truncated Click v2 field" };
  }

  if (wire !== WIRE_VARINT) return { kind: "invalid", reason: "unsupported Click v2 wire type" };

  const value = reader.varint();

  if (value === undefined) return { kind: "invalid", reason: "truncated Click v2 varint" };

  return Math.floor(tag / 8) === BUTTON_MAP_FIELD
    ? { kind: "buttonMap", value }
    : { kind: "skipped" };
}

function readButtonMap(data: ByteReader): ParseResult<number> {
  const reader = zwiftProtobufCursor(data);
  let buttonMap: number | undefined;

  while (!reader.done()) {
    const step = nextField(reader);

    if (step.kind === "invalid") return parseFailure(step.reason);

    if (step.kind === "buttonMap") {
      if (buttonMap !== undefined) return parseFailure("duplicate Click v2 button map");

      buttonMap = step.value;
    }
  }

  return buttonMap === undefined
    ? parseFailure("Click v2 frame without button map")
    : { ok: true, value: buttonMap };
}

/**
 * `0x23` RideKeyPadStatus: field 1 is the inverted uint32 button bitmap, field 3 the
 * repeated analog paddles (skipped). Unknown varint and length-delimited fields are
 * ignored; other wire types, truncation and a missing bitmap fail.
 */
export function parseClickV2Input(data: ByteReader): ParseResult<ClickV2Input> {
  if (data.byteLength < 1 || data.byteLength > 256 || data.getUint8(0) !== 0x23) {
    return parseFailure("not a Click v2 0x23 input");
  }

  const map = readButtonMap(data);

  if (!map.ok) return map;

  const pressed: ClickV2Button[] = [];

  for (const [name, bit] of BUTTON_BITS) {
    if (Math.floor(map.value / bit) % 2 === 0) {
      pressed.push(name);
    }
  }

  return { ok: true, value: { buttonMap: map.value, pressed } };
}

// UNVERIFIED: docs/02-bluetooth.md#zwift-click-v2
/** Vendor frames `ff 03 00 0a …` (unlock challenge) and `ff 05 00 ea|fa 05` (stopped). */
export function isClickV2LockNotice(data: ByteReader): boolean {
  if (data.byteLength < 4 || data.getUint8(0) !== 0xff) {
    return false;
  }

  const kind = data.getUint8(1);

  return (
    (kind === 0x03 && data.getUint8(2) === 0x00 && data.getUint8(3) === 0x0a) ||
    (kind === 0x05 &&
      data.byteLength === 5 &&
      data.getUint8(2) === 0x00 &&
      (data.getUint8(3) === 0xea || data.getUint8(3) === 0xfa) &&
      data.getUint8(4) === 0x05)
  );
}
