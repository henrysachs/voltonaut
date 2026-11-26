import { assert, property, uint8Array } from "fast-check";
import { expect, it } from "vitest";
import { bytesToDataView, parseHex, type ReadOnlyBytes } from "../bytes.js";
import { clickV2Side, isClickV2LockNotice, parseClickV2Input } from "./clickV2.js";

function view(hex: string): DataView {
  const bytes = parseHex(hex);

  if (bytes === undefined) throw new Error("invalid test hex");

  return bytesToDataView(bytes);
}

// Inverted bitmap: all bits set means nothing pressed (SwiftControl, pizero, RideControl).
const RELEASED = "23 08 ff ff ff ff 0f";

function pressed(mask: number): string {
  const map = 0xffffffff - mask;
  const bytes: string[] = [];
  let rest = map;

  for (let index = 0; index < 5; index += 1) {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push((rest > 0 ? low + 0x80 : low).toString(16).padStart(2, "0"));

    if (rest === 0) break;
  }

  return `23 08 ${bytes.join(" ")}`;
}

it("decodes the released state and each documented Click v2 button", () => {
  expect(parseClickV2Input(view(RELEASED))).toEqual({
    ok: true,
    value: { buttonMap: 0xffffffff, pressed: [] },
  });

  for (const [mask, button] of [
    [0x0001, "left"],
    [0x0002, "up"],
    [0x0004, "right"],
    [0x0008, "down"],
    [0x0100, "minus"],
    [0x0010, "a"],
    [0x0020, "b"],
    [0x0040, "y"],
    [0x0080, "z"],
    [0x1000, "plus"],
  ] as const) {
    expect(parseClickV2Input(view(pressed(mask)))).toMatchObject({
      ok: true,
      value: { pressed: [button] },
    });
  }
});

it("reports simultaneous presses and skips the analog paddle field", () => {
  const plusAndB = pressed(0x1000 + 0x0020);
  expect(parseClickV2Input(view(plusAndB))).toMatchObject({ value: { pressed: ["b", "plus"] } });
  expect(parseClickV2Input(view(`${RELEASED} 1a 04 08 00 10 00`))).toMatchObject({
    ok: true,
    value: { pressed: [] },
  });
  expect(parseClickV2Input(view("23 1a 02 08 00 08 ff ff ff ff 0f"))).toMatchObject({
    ok: true,
    value: { buttonMap: 0xffffffff },
  });
  expect(parseClickV2Input(view(`${RELEASED} 10 05`))).toMatchObject({ ok: true });
});

it("rejects other message types, truncation, duplicates and unsupported wire types", () => {
  for (const hex of [
    "",
    "07 08 00",
    "23",
    "23 08",
    "23 08 ff ff ff ff 1f",
    `${RELEASED} 08 00`,
    `${RELEASED} 1a 05 00`,
    `${RELEASED} 0d 00 00 00 00`,
    "23 00 00",
  ]) {
    expect(parseClickV2Input(view(hex)).ok).toBe(false);
  }
});

it("never throws for arbitrary bytes", () => {
  assert(
    property(uint8Array(), (bytes: ReadOnlyBytes) => {
      expect(() => parseClickV2Input(bytesToDataView(bytes))).not.toThrow();
    }),
  );
});

it("assigns buttons to pucks: plus and face buttons right, minus and pad left", () => {
  expect(clickV2Side("plus")).toBe("right");
  expect(clickV2Side("b")).toBe("right");
  expect(clickV2Side("minus")).toBe("left");
  expect(clickV2Side("up")).toBe("left");
});

it("recognizes the documented lock notices only", () => {
  expect(isClickV2LockNotice(view("ff 03 00 0a 10 22"))).toBe(true);
  expect(isClickV2LockNotice(view("ff 05 00 ea 05"))).toBe(true);
  expect(isClickV2LockNotice(view("ff 05 00 fa 05"))).toBe(true);
  expect(isClickV2LockNotice(view("ff 05 00 ea 05 00"))).toBe(false);
  expect(isClickV2LockNotice(view("ff 04 00 0a"))).toBe(false);
  expect(isClickV2LockNotice(view(RELEASED))).toBe(false);
  expect(isClickV2LockNotice(view("ff"))).toBe(false);
});
