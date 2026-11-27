import { parseFailure, type ByteReader, type ParseResult } from "../bytes.js";
import { zwiftProtobufCursor } from "./protobuf.js";

export type PlaySide = "left" | "right";

// UNVERIFIED: docs/02-bluetooth.md#grenzen-der-spielanbindung
interface PlayChannels {
  readonly rawAnalogLr: number;
  readonly rawAnalogUd: number;
}

interface PlayCommonButtons {
  readonly shift: boolean;
  // UNVERIFIED: docs/02-bluetooth.md#grenzen-der-spielanbindung
  readonly power: boolean;
}

export type PlayInput = PlayChannels &
  (
    | {
        readonly side: "left";
        readonly buttons: PlayCommonButtons & {
          readonly up: boolean;
          readonly down: boolean;
          readonly left: boolean;
          readonly right: boolean;
        };
      }
    | {
        readonly side: "right";
        readonly buttons: PlayCommonButtons & {
          readonly y: boolean;
          readonly z: boolean;
          readonly a: boolean;
          readonly b: boolean;
        };
      }
  );

function readFields(data: ByteReader): ReadonlyMap<number, number> | undefined {
  const reader = zwiftProtobufCursor(data);
  const fields = new Map<number, number>();

  while (!reader.done()) {
    const tag = reader.varint();
    const value = reader.varint();

    if (
      tag === undefined ||
      tag < 8 ||
      tag % 8 !== 0 ||
      value === undefined ||
      fields.has(tag / 8)
    ) {
      return undefined;
    }

    fields.set(tag / 8, value);
  }

  for (let field = 1; field <= 7; field += 1) {
    const value = fields.get(field);

    if (value !== 0 && value !== 1) {
      return undefined;
    }
  }

  return fields;
}

function zigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/** Observed full-state 0x07 frames only. Unknown varint fields are ignored. */
export function parsePlayInput(data: ByteReader): ParseResult<PlayInput> {
  if (data.byteLength < 1 || data.byteLength > 256 || data.getUint8(0) !== 0x07) {
    return parseFailure("not a supported Play 0x07 input");
  }

  const fields = readFields(data);
  const lr = fields?.get(8);
  const ud = fields?.get(9);

  if (fields === undefined || lr === undefined || ud === undefined) {
    return parseFailure("invalid or incomplete Play state");
  }

  const common = { shift: fields.get(6) === 0, power: fields.get(7) === 0 };
  const channels = { rawAnalogLr: zigzag(lr), rawAnalogUd: zigzag(ud) };

  const value: PlayInput =
    fields.get(1) === 1
      ? {
          ...channels,
          side: "left",
          buttons: {
            ...common,
            up: fields.get(2) === 0,
            left: fields.get(3) === 0,
            right: fields.get(4) === 0,
            down: fields.get(5) === 0,
          },
        }
      : {
          ...channels,
          side: "right",
          buttons: {
            ...common,
            y: fields.get(2) === 0,
            z: fields.get(3) === 0,
            a: fields.get(4) === 0,
            b: fields.get(5) === 0,
          },
        };

  return { ok: true, value };
}
