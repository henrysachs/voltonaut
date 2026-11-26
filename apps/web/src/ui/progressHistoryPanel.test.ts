import { expect, it } from "vitest";
import { ProgressHistoryJournalSchema } from "@voltonaut/shared";

import { historyJournalText, historyStatusText } from "./progressHistoryPanel.js";

const JOURNAL = ProgressHistoryJournalSchema.parse({
  journalId: "6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  routeId: "test-loop",
  startedAt: "2026-11-26T08:00:00.000Z",
  lastConfirmedAt: "2026-11-26T08:30:00.000Z",
  confirmedTicks: 1800,
  rangeCount: 3,
  rewardDays: ["2026-11-26"],
  awardedVolts: 1200,
  withheldVolts: 5,
  candidateVolts: 1205,
});

it("describes a journal with day, period and confirmed Volts", () => {
  expect(historyJournalText(JOURNAL, "UTC")).toBe(
    "26.11.2026, 08:00–08:30 · 1.200 ⚡ bestätigt · 5 ⚡ über Tageslimit · 3 Abschnitte",
  );
  expect(
    historyJournalText(
      ProgressHistoryJournalSchema.parse({
        ...JOURNAL,
        rangeCount: 1,
        withheldVolts: 0,
        candidateVolts: 1200,
      }),
      "Europe/Berlin",
    ),
  ).toBe("26.11.2026, 09:00–09:30 · 1.200 ⚡ bestätigt · 1 Abschnitt");
});

it("states the server balance only once the server answered", () => {
  expect(historyStatusText({ kind: "guest" })).not.toMatch(/\d/u);
  expect(historyStatusText({ kind: "loading" })).not.toMatch(/\d/u);
  expect(historyStatusText({ kind: "failed", message: "Historie nicht erreichbar." })).toBe(
    "Historie nicht erreichbar.",
  );
  expect(
    historyStatusText({ kind: "ready", voltsBalance: 3400, journals: [], truncated: false }),
  ).toBe("Kontostand laut Server: 3.400 ⚡. Noch keine bestätigten Fahrten.");
  expect(
    historyStatusText({ kind: "ready", voltsBalance: 0, journals: [JOURNAL], truncated: true }),
  ).toBe("Kontostand laut Server: 0 ⚡. Gezeigt werden die neuesten Fahrten.");
});
