import leftCapture from "../../../../fixtures/ble/zwift-play-left-hardware-20261120.json" with { type: "json" };
import rightCapture from "../../../../fixtures/ble/zwift-play-right-hardware-20261120.json" with { type: "json" };
import { expect, it } from "vitest";
import { assert, property, uint8Array } from "fast-check";
import { parseBleFixtureJson, type BleFixture } from "../fixtureSchema.js";
import { bytesToDataView, parseHex, type ReadOnlyBytes } from "../bytes.js";
import { parsePlayInput, type PlayInput } from "./parse.js";

function capture(side: "left" | "right"): BleFixture {
  const result = parseBleFixtureJson(JSON.stringify(side === "left" ? leftCapture : rightCapture));

  if (!result.ok) {
    throw new Error(result.failure.reason);
  }

  return result.value;
}

function decode(hex: string) {
  const bytes = parseHex(hex);

  if (bytes === undefined) {
    throw new Error("invalid test hex");
  }

  return parsePlayInput(bytesToDataView(bytes));
}

function hardwareFrames(side: "left" | "right") {
  const frames: { readonly marker: string; readonly input: PlayInput }[] = [];
  let marker = "";

  for (const entry of capture(side).log) {
    if (entry.kind === "event") {
      marker = entry.marker.trim();
    } else if (entry.dir === "rx" && entry.hex.startsWith("07 ")) {
      const parsed = decode(entry.hex);

      if (!parsed.ok) {
        throw new Error(parsed.failure.reason);
      }

      frames.push({ marker, input: parsed.value });
    }
  }

  return frames;
}

it("decodes every genuine frame with the hardware-verified side and raw analog range", () => {
  const right = hardwareFrames("right");
  const left = hardwareFrames("left");
  expect(right).toHaveLength(465);
  expect(left).toHaveLength(182);
  expect(right.every(({ input }) => input.side === "right")).toBe(true);
  expect(left.every(({ input }) => input.side === "left")).toBe(true);
  expect(Math.min(...right.map(({ input }) => input.rawAnalogLr))).toBe(-100);
  expect(Math.max(...right.map(({ input }) => input.rawAnalogLr))).toBe(100);
  expect(right.every(({ input }) => input.rawAnalogUd === 0)).toBe(true);
  expect(left.every(({ input }) => input.rawAnalogLr === 0)).toBe(true);
  expect(left.every(({ input }) => input.rawAnalogUd === 0)).toBe(true);
});

interface MarkedCase {
  readonly side: "left" | "right";
  readonly marker: string;
  readonly pressed: (input: PlayInput) => boolean;
}

const MARKED_CASES: readonly MarkedCase[] = [
  { side: "right", marker: "A", pressed: (input) => input.side === "right" && input.buttons.a },
  { side: "right", marker: "B", pressed: (input) => input.side === "right" && input.buttons.b },
  { side: "right", marker: "Y", pressed: (input) => input.side === "right" && input.buttons.y },
  { side: "right", marker: "Z", pressed: (input) => input.side === "right" && input.buttons.z },
  { side: "right", marker: "Schalter Seite", pressed: (input) => input.buttons.shift },
  { side: "left", marker: "Oben", pressed: (input) => input.side === "left" && input.buttons.up },
  {
    side: "left",
    marker: "unten",
    pressed: (input) => input.side === "left" && input.buttons.down,
  },
  {
    side: "left",
    marker: "links",
    pressed: (input) => input.side === "left" && input.buttons.left,
  },
  {
    side: "left",
    marker: "rechts",
    pressed: (input) => input.side === "left" && input.buttons.right,
  },
  { side: "left", marker: "schalten", pressed: (input) => input.buttons.shift },
];

it.each(MARKED_CASES)(
  "matches marked $side $marker presses and releases",
  ({ side, marker, pressed }) => {
    const states: boolean[] = [];

    for (const frame of hardwareFrames(side).filter((entry) => entry.marker === marker)) {
      states.push(pressed(frame.input));
    }

    expect(states).toContain(true);
    expect(states).toContain(false);
  },
);

const RELEASED = "07 08 00 10 01 18 01 20 01 28 01 30 01 38 01 40 00 48 00";

it("rejects incomplete, duplicated, invalid-enum, overflow and unsupported wire data", () => {
  for (const hex of [
    "",
    "07",
    "15 08 00",
    "23 08 00",
    RELEASED.slice(0, -6),
    `${RELEASED} 08 00`,
    RELEASED.replace("08 00", "08 02"),
    RELEASED.replace("30 01", "30 02"),
    `${RELEASED} 50 80`,
    `${RELEASED} 50 ff ff ff ff 10`,
    `${RELEASED} 52 00`,
    `${RELEASED} 00 00`,
  ]) {
    expect(decode(hex).ok).toBe(false);
  }
});

it("bounds varints and ignores well-formed unknown varint fields", () => {
  expect(decode(`${RELEASED} 50 01`)).toEqual(decode(RELEASED));
  expect(decode(RELEASED.replace("40 00", "40 ff ff ff ff 0f"))).toMatchObject({
    ok: true,
    value: { rawAnalogLr: -2147483648 },
  });
  expect(decode(RELEASED.replace("48 00", "48 fe ff ff ff 0f"))).toMatchObject({
    ok: true,
    value: { rawAnalogUd: 2147483647 },
  });
  expect(decode(RELEASED.replace("40 00", "40 01"))).toMatchObject({
    ok: true,
    value: { rawAnalogLr: -1 },
  });
});

it("never throws for arbitrary bytes", () => {
  assert(
    property(uint8Array(), (bytes: ReadOnlyBytes) => {
      expect(() => parsePlayInput(bytesToDataView(bytes))).not.toThrow();
    }),
  );
});
