import { describe, expect, it } from "vitest";

import { normalizeUuid, toShortUuid } from "./uuids.js";

describe("normalizeUuid", () => {
  it("expands short and 0x-prefixed forms into the standard base UUID", () => {
    expect(normalizeUuid("0x1826")).toBe("00001826-0000-1000-8000-00805f9b34fb");
    expect(normalizeUuid("1826")).toBe("00001826-0000-1000-8000-00805f9b34fb");
    expect(normalizeUuid("0xFC82")).toBe("0000fc82-0000-1000-8000-00805f9b34fb");
  });

  it("lowercases and passes through full 128-bit UUIDs", () => {
    expect(normalizeUuid("00000001-19CA-4651-86E5-FA29DCDD09D1")).toBe(
      "00000001-19ca-4651-86e5-fa29dcdd09d1",
    );
  });

  it("rejects non-UUID strings", () => {
    expect(normalizeUuid("RideOn")).toBeUndefined();
    expect(normalizeUuid("0x123456789")).toBeUndefined();
    expect(normalizeUuid("12345678-1234-1234-1234")).toBeUndefined();
    expect(normalizeUuid("")).toBeUndefined();
  });
});

describe("toShortUuid", () => {
  it("shortens standard UUIDs to the 0x form", () => {
    expect(toShortUuid("00001826-0000-1000-8000-00805f9b34fb")).toBe("0x1826");
  });

  it("keeps proprietary UUIDs in full form", () => {
    expect(toShortUuid("00000001-19ca-4651-86e5-fa29dcdd09d1")).toBe(
      "00000001-19ca-4651-86e5-fa29dcdd09d1",
    );
  });
});
