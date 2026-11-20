import { describe, expect, it } from "vitest";

import {
  byteReader,
  bytesCopy,
  readerBytes,
  readOnlyBytes,
  parseFailure,
  parseHex,
  readUint24LE,
  toAscii,
  toHex,
} from "./bytes.js";

function dataView(bytes: readonly number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

describe("byteReader", () => {
  it("reads from a DataView through the read-only surface", () => {
    const reader = byteReader(dataView([0x80, 0x96, 0x98, 0x01]));

    expect(reader.byteLength).toBe(4);
    expect(reader.getUint8(0)).toBe(0x80);
    expect(reader.getUint16(1, true)).toBe(0x9896);
    expect(reader.getInt16(2, true)).toBe(0x0198);
    expect(reader.getUint32(0, true)).toBe(0x01989680);
  });
});

describe("readerBytes", () => {
  it("materializes the reader into writable bytes", () => {
    const bytes = readerBytes(byteReader(dataView([0xaa, 0xbb])));

    expect(Array.from(bytes)).toEqual([0xaa, 0xbb]);
  });
});

describe("readOnlyBytes", () => {
  it("exposes length and at of the wrapped bytes", () => {
    const bytes = readOnlyBytes(Uint8Array.from([1, 2, 3]));

    expect(bytes.length).toBe(3);
    expect(bytes.at(0)).toBe(1);
    expect(bytes.at(2)).toBe(3);
    expect(bytes.at(3)).toBeUndefined();
  });

  it("bytesCopy rebuilds a writable copy", () => {
    const copy = bytesCopy(readOnlyBytes(Uint8Array.from([9, 8, 7])));

    expect(copy.at(0)).toBe(9);
    expect(copy.at(2)).toBe(7);
  });
});

describe("toHex", () => {
  it("renders lowercase hex with single spaces", () => {
    expect(toHex(readOnlyBytes(Uint8Array.from([0x44, 0x02, 0x5a])))).toBe("44 02 5a");
  });

  it("renders an empty array as an empty string", () => {
    expect(toHex(readOnlyBytes(new Uint8Array(0)))).toBe("");
  });
});

describe("parseHex", () => {
  it("accepts space separated pairs in mixed case", () => {
    expect(parseHex("44 02 5A")).toEqual(new Uint8Array([0x44, 0x02, 0x5a]));
  });

  it("accepts a compact string and commas", () => {
    expect(parseHex("4402")).toEqual(new Uint8Array([0x44, 0x02]));
    expect(parseHex(" 44, 02 ")).toEqual(new Uint8Array([0x44, 0x02]));
  });

  it("accepts an empty string", () => {
    expect(parseHex("")).toEqual(new Uint8Array([]));
    expect(parseHex("   ")).toEqual(new Uint8Array([]));
  });

  it("rejects odd digits, letters outside hex and stray characters", () => {
    expect(parseHex("4")).toBeUndefined();
    expect(parseHex("44 2")).toBeUndefined();
    expect(parseHex("zz")).toBeUndefined();
    expect(parseHex("44 0x02")).toBeUndefined();
  });
});

describe("toAscii", () => {
  it("keeps printable bytes and dots the rest", () => {
    expect(toAscii(readOnlyBytes(Uint8Array.from([0x41, 0x00, 0x7e])))).toBe("A.~");
  });
});

describe("readUint24LE", () => {
  it("composes the little-endian 24-bit value", () => {
    expect(readUint24LE(byteReader(dataView([0x80, 0x96, 0x98])), 0)).toBe(10_000_000);
    expect(readUint24LE(byteReader(dataView([0x00, 0x00, 0x01])), 0)).toBe(0x10000);
  });

  it("reads at an offset", () => {
    expect(readUint24LE(byteReader(dataView([0xff, 0x01, 0x02, 0x03])), 1)).toBe(0x030201);
  });
});

describe("parseFailure", () => {
  it("builds the failure variant of a parse result", () => {
    const result = parseFailure<number>("truncated");

    expect(result).toEqual({ ok: false, failure: { reason: "truncated" } });
  });
});
