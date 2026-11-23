import { expect, it } from "vitest";
import { TEST_LOOP } from "@voltonaut/engine";

import type { SegmentProgress } from "../game/segments.js";
import { renderSegmentHud } from "./hud.js";

const cases: readonly { readonly progress: SegmentProgress; readonly text: string }[] = [
  { progress: { kind: "idle" }, text: "Sprint · ab 2.0 km" },
  {
    progress: { kind: "active", lap: 1, elapsedS: 12.35, remainingM: 123.1 },
    text: "Sprint · R2 · 12.3 s · noch 124 m",
  },
  {
    progress: { kind: "finished", lap: 2, timeS: 30.25 },
    text: "Sprint · R3 · 30.3 s · vorläufig",
  },
  { progress: { kind: "invalid", reason: "clock_skipped" }, text: "Sprint · ungültig · Zeitlücke" },
  {
    progress: { kind: "invalid", reason: "missing_entry" },
    text: "Sprint · ungültig · Start fehlt",
  },
  {
    progress: { kind: "invalid", reason: "invalid_timing" },
    text: "Sprint · ungültig · Zeitfolge unvollständig",
  },
  {
    progress: { kind: "invalid", reason: "engine_unavailable" },
    text: "Sprint · ungültig · Engine nicht verfügbar",
  },
];

it.each(cases)("renders honest segment preview $text", ({ progress, text }) => {
  const writes: string[] = [];
  renderSegmentHud(
    {
      scope: "session_preview",
      timing: "tick",
      rows: TEST_LOOP.segments.map((segment) => ({ segment, progress })),
    },
    {
      sprint: {
        write: (value) => {
          writes.push(value);
        },
      },
      kom: {
        write: (value) => {
          writes.push(value);
        },
      },
    },
  );
  expect(writes[0]).toBe(text);
  expect(writes[1]).toContain("KOM");
});

it("clears absent segments rather than leaving an earlier result", () => {
  const writes: string[] = [];

  const target = {
    write: (value: string) => {
      writes.push(value);
    },
  };

  renderSegmentHud(
    { scope: "session_preview", timing: "tick", rows: [] },
    { sprint: target, kom: target },
  );
  expect(writes).toEqual(["", ""]);
});
