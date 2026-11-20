export interface ByteReader {
  readonly byteLength: number;
  readonly getUint8: (byteOffset: number) => number;
  readonly getUint16: (byteOffset: number, littleEndian?: boolean) => number;
  readonly getInt16: (byteOffset: number, littleEndian?: boolean) => number;
  readonly getUint32: (byteOffset: number, littleEndian?: boolean) => number;
}

/** Read-only byte sequence; Uint8Array satisfies this structurally. */
export interface ReadOnlyBytes {
  readonly length: number;
  readonly at: (index: number) => number | undefined;
}

export function byteReader(view: ByteReader): ByteReader {
  return {
    byteLength: view.byteLength,
    getUint8: (byteOffset) => view.getUint8(byteOffset),
    getUint16: (byteOffset, littleEndian) => view.getUint16(byteOffset, littleEndian),
    getInt16: (byteOffset, littleEndian) => view.getInt16(byteOffset, littleEndian),
    getUint32: (byteOffset, littleEndian) => view.getUint32(byteOffset, littleEndian),
  };
}

export function readOnlyBytes(bytes: ReadOnlyBytes): ReadOnlyBytes {
  return {
    length: bytes.length,
    at: (index) => bytes.at(index),
  };
}

/** Materializes a reader into fresh writable bytes (display paths and tests). */
export function readerBytes(reader: ByteReader): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(reader.byteLength);
  let offset = 0;

  while (offset < reader.byteLength) {
    bytes[offset] = reader.getUint8(offset);
    offset += 1;
  }

  return bytes;
}

/** DataView over a fresh copy of the bytes; property tests build inputs with it. */
export function bytesToDataView(bytes: ReadOnlyBytes): DataView {
  return new DataView(bytesCopy(bytes).buffer);
}

/** Rebuilds a writable copy; only the Web Bluetooth write path needs this. */
export function bytesCopy(bytes: ReadOnlyBytes): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  let index = 0;

  while (index < bytes.length) {
    copy[index] = bytes.at(index) ?? 0;
    index += 1;
  }

  return copy;
}

export interface ParseFailure {
  readonly reason: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ParseFailure };

export function parseFailure<T>(reason: string): ParseResult<T> {
  return { ok: false, failure: { reason } };
}

const HEX_DIGITS = "0123456789abcdef";

/** Lowercase hex, one space between bytes: "44 02 5a 00". Empty input returns "". */
export function toHex(bytes: ReadOnlyBytes): string {
  let hex = "";
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes.at(index) ?? 0;

    if (index > 0) {
      hex += " ";
    }

    hex += HEX_DIGITS[byte >> 4] ?? "0";
    hex += HEX_DIGITS[byte & 0x0f] ?? "0";
    index += 1;
  }

  return hex;
}

const HEX_DIGITS_ONLY_PATTERN = /^[0-9a-fA-F]+$/u;

/** Parse "44 02" / "4402" / "44, 02" style hex into bytes; undefined when malformed. */
export function parseHex(text: string): Uint8Array<ArrayBuffer> | undefined {
  const compact = text.replaceAll(/[\s,]+/gu, "");

  if (compact.length === 0) {
    return new Uint8Array(0);
  }

  if (compact.length % 2 !== 0 || !HEX_DIGITS_ONLY_PATTERN.test(compact)) {
    return undefined;
  }

  const bytes = new Uint8Array(compact.length / 2);

  for (const [index] of bytes.entries()) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

/** Printable ASCII rendering; non-printable bytes become ".". */
export function toAscii(bytes: ReadOnlyBytes): string {
  let ascii = "";
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes.at(index) ?? 0;

    ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCodePoint(byte) : ".";
    index += 1;
  }

  return ascii;
}

/** Little-endian 24-bit unsigned integer; the caller checks the bounds. */
export function readUint24LE(view: ByteReader, offset: number): number {
  return (
    view.getUint8(offset) + view.getUint8(offset + 1) * 0x100 + view.getUint8(offset + 2) * 0x10000
  );
}
