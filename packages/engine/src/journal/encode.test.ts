import { describe, expect, it } from "vitest";
import {
  RecordingEntryV2Schema,
  type ControllerButton,
  type DeviceEvent,
  type RecordingEntryV2,
} from "@voltonaut/shared";

import { encodeJournalInput, type JournalInputDecision } from "./encode.js";

function trainer(readings: {
  readonly powerW?: number;
  readonly cadenceRpm?: number;
  readonly speedMps?: number;
}): DeviceEvent {
  return { type: "trainer.data", tS: 99, ...readings };
}

function journalEntries(decision: JournalInputDecision): readonly RecordingEntryV2[] {
  return decision.kind === "entry" ? [decision.entry] : [];
}

function button(name: ControllerButton, pressed = true): DeviceEvent {
  return { type: "controller.button", tS: 1, button: name, pressed, source: "test" };
}

describe("encodeJournalInput trainer readings", () => {
  it("keeps in-range readings and the worker time, not the device time", () => {
    expect(encodeJournalInput(trainer({ powerW: 250, cadenceRpm: 90, speedMps: 8 }), 1234)).toEqual(
      { kind: "entry", entry: [0, 1234, "trainer", 250, 90, 8], rejected: [] },
    );
  });

  it("writes absent readings as null without rejecting them", () => {
    expect(encodeJournalInput(trainer({}), 5)).toEqual({
      kind: "entry",
      entry: [0, 5, "trainer", null, null, null],
      rejected: [],
    });
  });

  it.each([
    ["powerW", 0, 2000, 2000.001],
    ["cadenceRpm", 0, 200, 200.001],
    ["speedMps", 0, 100, 100.001],
  ] as const)("accepts %s on [%d, %d] and rejects above", (field, min, max, above) => {
    for (const value of [min, max]) {
      expect(encodeJournalInput(trainer({ [field]: value }), 0)).toMatchObject({
        kind: "entry",
        rejected: [],
      });
    }

    for (const value of [above, -0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(encodeJournalInput(trainer({ [field]: value }), 0)).toMatchObject({
        kind: "entry",
        rejected: [field],
      });
    }
  });

  it("nulls each rejected reading and lists every rejected channel in order", () => {
    expect(
      encodeJournalInput(trainer({ powerW: 2001, cadenceRpm: -1, speedMps: Number.NaN }), 7),
    ).toEqual({
      kind: "entry",
      entry: [0, 7, "trainer", null, null, null],
      rejected: ["powerW", "cadenceRpm", "speedMps"],
    });
    expect(encodeJournalInput(trainer({ powerW: 100, cadenceRpm: 300, speedMps: 4 }), 7)).toEqual({
      kind: "entry",
      entry: [0, 7, "trainer", 100, null, 4],
      rejected: ["cadenceRpm"],
    });
  });
});

describe("encodeJournalInput heart rate", () => {
  it.each([1, 130, 250])("records %d bpm", (bpm) => {
    expect(encodeJournalInput({ type: "hr.data", tS: 0, bpm }, 40)).toEqual({
      kind: "entry",
      entry: [0, 40, "hr", bpm],
      rejected: [],
    });
  });

  it.each([0.999, 250.001, Number.NaN, Number.POSITIVE_INFINITY])("rejects %d bpm", (bpm) => {
    expect(encodeJournalInput({ type: "hr.data", tS: 0, bpm }, 40)).toEqual({
      kind: "rejected",
      rejected: ["hrBpm"],
    });
  });
});

describe("encodeJournalInput controller buttons", () => {
  it.each(["shiftUp", "shiftDown"] as const)("records a pressed %s", (name) => {
    expect(encodeJournalInput(button(name), 300)).toEqual({
      kind: "entry",
      entry: [0, 300, "shift", name],
      rejected: [],
    });
  });

  it("marks powerUp as an intent only unrecordable modes read", () => {
    expect(encodeJournalInput(button("powerUp"), 0)).toEqual({
      kind: "ignored",
      reason: "unrecordable_mode_intent",
    });
  });

  it.each(["navUp", "navDown", "navLeft", "navRight", "confirm", "back", "brake"] as const)(
    "ignores %s because the engine never reads it",
    (name) => {
      expect(encodeJournalInput(button(name), 0)).toEqual({
        kind: "ignored",
        reason: "no_engine_effect",
      });
    },
  );

  it.each(["shiftUp", "shiftDown", "powerUp"] as const)("ignores a released %s", (name) => {
    expect(encodeJournalInput(button(name, false), 0)).toEqual({
      kind: "ignored",
      reason: "no_engine_effect",
    });
  });
});

describe("encodeJournalInput device events", () => {
  it("records device status by kind without the device id", () => {
    expect(
      encodeJournalInput(
        { type: "device.status", tS: 0, kind: "heartRate", id: "hr-1", status: "reconnecting" },
        12,
      ),
    ).toEqual({
      kind: "entry",
      entry: [0, 12, "status", "heartRate", "reconnecting"],
      rejected: [],
    });
  });

  it.each<DeviceEvent>([
    { type: "controller.battery", tS: 0, percent: 80 },
    { type: "trainer.controlResult", tS: 0, opCode: 0x11, result: "success" },
  ])("ignores $type", (event) => {
    expect(encodeJournalInput(event, 0)).toEqual({ kind: "ignored", reason: "no_engine_effect" });
  });
});

it("emits only entries the shared journal contract accepts", () => {
  const events: readonly DeviceEvent[] = [
    trainer({ powerW: 2000, cadenceRpm: 200, speedMps: 100 }),
    trainer({ powerW: 5000, cadenceRpm: -3 }),
    { type: "hr.data", tS: 0, bpm: 250 },
    button("shiftDown"),
    { type: "device.status", tS: 0, kind: "keyboard", id: "k", status: "error" },
  ];

  const entries = events.flatMap((event) => journalEntries(encodeJournalInput(event, 1000)));

  expect(entries).toHaveLength(events.length);
  expect(entries.every((entry) => RecordingEntryV2Schema.safeParse(entry).success)).toBe(true);
});
