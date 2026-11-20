import { describe, expect, it } from "vitest";

import type { BleFixture } from "./fixtureSchema.js";
import { parseBleFixtureJson } from "./fixtureSchema.js";

const VALID_FIXTURE = {
  meta: {
    schemaVersion: 1,
    ua: "vitest",
    date: "2026-11-19T20:15:00.000Z",
    deviceName: "KICKR CORE",
    deviceId: "abc-def",
    firmware: "1.0.44",
    protocol: "ftms",
    notes: "",
  },
  gatt: [
    {
      service: "0x1826",
      characteristics: [
        { char: "0x2ACC", properties: ["read"] },
        { char: "0x2AD2", properties: ["notify"] },
      ],
    },
  ],
  log: [
    {
      tMs: 1234.5,
      device: "KICKR CORE",
      service: "0x1826",
      char: "0x2AD2",
      dir: "rx",
      hex: "44 02 5a 00 08 00 00",
      decoded: "8 W, 45 rpm",
    },
    {
      tMs: 5678.9,
      device: "KICKR CORE",
      service: "0x1826",
      char: "0x2AD9",
      dir: "tx",
      hex: "11 00 00 c2 01 28 33",
      marker: "Sim 4.5 % gesetzt",
    },
    { tMs: 9101.1, device: "KICKR CORE", event: "disconnected" },
  ],
};

function parseOk(value: Parameters<typeof JSON.stringify>[0]): boolean {
  return parseBleFixtureJson(JSON.stringify(value)).ok;
}

function parseValidFixture(): BleFixture {
  const result = parseBleFixtureJson(JSON.stringify(VALID_FIXTURE));

  expect(result.ok).toBe(true);

  return result.ok ? result.value : unreachableFailure();
}

function unreachableFailure(): BleFixture {
  throw new Error("expected the fixture to parse");
}

describe("parseBleFixtureJson", () => {
  it("accepts the documented fixture shape and fills the defaults", () => {
    const fixture = parseValidFixture();

    expect(fixture.meta.protocol).toBe("ftms");
    expect(fixture.gatt[0]?.characteristics[1]?.char).toBe("0x2AD2");
    expect(fixture.log).toHaveLength(3);
    expect(fixture.log[0]?.kind).toBe("data");
    expect(fixture.log[1]?.kind).toBe("data");
    expect(fixture.log[1]?.marker).toBe("Sim 4.5 % gesetzt");
    expect(fixture.log[2]?.kind).toBe("event");
  });

  it("rejects uppercase hex bytes", () => {
    expect(parseOk({ ...VALID_FIXTURE, log: [{ ...VALID_FIXTURE.log[0], hex: "44 02 5A" }] })).toBe(
      false,
    );
  });

  it("rejects unknown properties, protocols and schema versions", () => {
    expect(
      parseOk({
        ...VALID_FIXTURE,
        gatt: [
          { service: "0x1826", characteristics: [{ char: "0x2AD2", properties: ["explode"] }] },
        ],
      }),
    ).toBe(false);
    expect(parseOk({ ...VALID_FIXTURE, meta: { ...VALID_FIXTURE.meta, protocol: "ant" } })).toBe(
      false,
    );
    expect(parseOk({ ...VALID_FIXTURE, meta: { ...VALID_FIXTURE.meta, schemaVersion: 2 } })).toBe(
      false,
    );
  });
});

describe("fixture boundary rejection", () => {
  it("rejects malformed uuids and non-ISO dates", () => {
    expect(
      parseOk({
        ...VALID_FIXTURE,
        gatt: [{ service: "1826", characteristics: [{ char: "0x2AD2", properties: ["read"] }] }],
      }),
    ).toBe(false);
    expect(parseOk({ ...VALID_FIXTURE, meta: { ...VALID_FIXTURE.meta, date: "yesterday" } })).toBe(
      false,
    );
  });

  it("rejects log entries that go back in time", () => {
    expect(
      parseOk({
        ...VALID_FIXTURE,
        log: [
          { ...VALID_FIXTURE.log[0], tMs: 5000 },
          { ...VALID_FIXTURE.log[0], tMs: 1000 },
        ],
      }),
    ).toBe(false);
  });

  it("rejects malformed input instead of throwing", () => {
    expect(parseBleFixtureJson("not json").ok).toBe(false);
    expect(parseBleFixtureJson("null").ok).toBe(false);
    expect(parseBleFixtureJson('"log"').ok).toBe(false);
    expect(parseBleFixtureJson('{"meta":{}}').ok).toBe(false);
  });
});
