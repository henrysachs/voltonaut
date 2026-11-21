import { expect, it } from "vitest";
import { bytesToDataView, toHex } from "../bytes.js";
import { encodeSimulation, parseControlResponse, type SimulationCommand } from "./controlCodec.js";

function encodedHex(command: SimulationCommand): string {
  const encoded = encodeSimulation(command);

  if (!encoded.ok) throw new Error(encoded.failure.reason);

  return toHex(encoded.value.bytes);
}

it("encodes standard signed wind/grade and Crr/Cw resolutions", () => {
  const encoded = encodedHex({
    type: "simulation",
    windMps: -1.234,
    gradePct: 4.5,
    crr: 0.004,
    cwKgPerM: 0.51,
  });

  expect(encoded).toBe("11 2e fb c2 01 28 33");
});

it("clamps finite extremes conservatively, never wraps", () => {
  const encoded = encodedHex({
    type: "simulation",
    windMps: 100,
    gradePct: 20,
    crr: 1,
    cwKgPerM: 10,
  });

  expect(encoded).toBe("11 ff 7f e8 03 ff ff");

  const negative = encodedHex({
    type: "simulation",
    windMps: -100,
    gradePct: -10,
    crr: 0,
    cwKgPerM: 0,
  });

  expect(negative).toBe("11 00 80 0c fe 00 00");
});

it.each([NaN, Infinity, -Infinity])("rejects non-finite fields: %s", (value) => {
  for (const field of ["windMps", "gradePct", "crr", "cwKgPerM"]) {
    expect(
      encodeSimulation({
        type: "simulation",
        windMps: 0,
        gradePct: 0,
        crr: 0.004,
        cwKgPerM: 0.51,
        [field]: value,
      }).ok,
    ).toBe(false);
  }
});

it("rejects physically nonsensical negative coefficients", () => {
  expect(
    encodeSimulation({
      type: "simulation",
      windMps: 0,
      gradePct: 0,
      crr: -1,
      cwKgPerM: 0.51,
    }).ok,
  ).toBe(false);
});

it("parses exact responses only, including permission refusal", () => {
  expect(parseControlResponse(bytesToDataView(Uint8Array.from([0x80, 0x11, 5])))).toEqual({
    ok: true,
    value: { opcode: 0x11, result: "notPermitted" },
  });

  for (const bytes of [[], [0x80, 0], [0, 0, 1], [0x80, 0, 6], [0x80, 0, 1, 0]]) {
    expect(parseControlResponse(bytesToDataView(Uint8Array.from(bytes))).ok).toBe(false);
  }
});
