import { expect, it } from "vitest";
import type { DeviceEvent, RecordingEntryV2 } from "@voltonaut/shared";

import { applyJournalEntry } from "./apply.js";

type Call =
  | { readonly kind: "ingest"; readonly event: DeviceEvent }
  | { readonly kind: "advance"; readonly elapsedS: number };

function recordingEngine() {
  const calls: Call[] = [];

  return {
    calls,
    engine: {
      ingest: (event: DeviceEvent) => {
        calls.push({ kind: "ingest", event });
      },
      advance: (elapsedS: number) => {
        calls.push({ kind: "advance", elapsedS });

        return [];
      },
    },
  };
}

function applied(entry: RecordingEntryV2, clockScale = 1): readonly Call[] {
  const { calls, engine } = recordingEngine();
  applyJournalEntry(engine, entry, clockScale);

  return calls;
}

it("feeds trainer readings at worker seconds and omits null channels", () => {
  expect(applied([3, 2500, "trainer", 250, null, 0])).toEqual([
    { kind: "ingest", event: { type: "trainer.data", tS: 2.5, powerW: 250, speedMps: 0 } },
  ]);
  expect(applied([3, 0, "trainer", null, 90, null])).toEqual([
    { kind: "ingest", event: { type: "trainer.data", tS: 0, cadenceRpm: 90 } },
  ]);
  expect(applied([3, 0, "trainer", null, null, null])).toEqual([
    { kind: "ingest", event: { type: "trainer.data", tS: 0 } },
  ]);
});

it("feeds heart rate and pressed shifts", () => {
  expect(applied([1, 1000, "hr", 140])).toEqual([
    { kind: "ingest", event: { type: "hr.data", tS: 1, bpm: 140 } },
  ]);
  expect(applied([2, 4000, "shift", "shiftDown"])).toEqual([
    {
      kind: "ingest",
      event: {
        type: "controller.button",
        tS: 4,
        button: "shiftDown",
        pressed: true,
        source: "recording-v2",
      },
    },
  ]);
});

it("scales advances by the recorded clock scale", () => {
  expect(applied([4, 1000, "advance", 0.5], 4)).toEqual([{ kind: "advance", elapsedS: 2 }]);
  expect(applied([4, 1000, "advance", 0.25])).toEqual([{ kind: "advance", elapsedS: 0.25 }]);
});

it.each<RecordingEntryV2>([
  [0, 0, "arm"],
  [1, 0, "status", "trainer", "ready"],
  [2, 0, "boundary", "start"],
])("does not touch the engine for %j", (entry) => {
  expect(applied(entry)).toEqual([]);
});
