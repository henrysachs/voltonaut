import type { ByteReader } from "../bytes.js";

/**
 * Cursor over the protobuf body of a Zwift controller frame: byte 0 is the message
 * type, the rest is protobuf. Controllers only send uint32 varints and
 * length-delimited fields, so nothing else is supported.
 */
export interface ZwiftProtobufCursor {
  readonly done: () => boolean;
  /** uint32 varint; undefined when truncated or wider than 32 bits. */
  readonly varint: () => number | undefined;
  /** Skips a length-delimited payload; false when the frame ends early. */
  readonly skip: (length: number) => boolean;
}

export function zwiftProtobufCursor(data: ByteReader): ZwiftProtobufCursor {
  let offset = 1;

  const varint = (): number | undefined => {
    let value = 0;

    for (let index = 0; index < 5; index += 1) {
      if (offset >= data.byteLength) {
        return undefined;
      }

      const byte = data.getUint8(offset);
      offset += 1;

      if (index === 4 && byte > 0x0f) {
        return undefined;
      }

      value += (byte & 0x7f) * 2 ** (index * 7);

      if (byte < 0x80) {
        return value;
      }
    }

    return undefined;
  };

  return {
    done: () => offset === data.byteLength,
    varint,
    skip(length) {
      if (offset + length > data.byteLength) {
        return false;
      }

      offset += length;

      return true;
    },
  };
}
