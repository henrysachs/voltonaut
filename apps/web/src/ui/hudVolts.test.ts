import { expect, it } from "vitest";

import type { ProgressLiveView } from "../sync/progressLive.js";
import { hudVoltsText } from "./hudVolts.js";

const CONFIRMED: ProgressLiveView = {
  previewVolts: 12,
  confirmedVolts: 9,
  withheldVolts: 2,
  status: "confirmed",
};

it("shows preview, confirmed part, status and the withheld rest", () => {
  expect(hudVoltsText(CONFIRMED)).toBe(
    "⚡ 12 vorläufig · 9 bestätigt · vom Server bestätigt · 2 über Tageslimit",
  );
  expect(
    hudVoltsText({ ...CONFIRMED, confirmedVolts: null, withheldVolts: 0, status: "offline" }),
  ).toBe("⚡ 12 vorläufig · – bestätigt · offline – wartet lokal");
  expect(hudVoltsText({ ...CONFIRMED, previewVolts: null })).toBe("");
});
