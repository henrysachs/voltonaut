import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createScheduler, QUALITY_SETTINGS, type RenderSystem } from "./scheduler.js";

const EXPECTED_ORDER = ["environment", "road", "riders", "camera", "debug"];

const FRAME = {
  ride: createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE }).snapshot(),
  dtS: 0.05,
  alpha: 1,
};

it("initializes, updates and changes quality in order, then disposes once in reverse", () => {
  const calls: string[] = [];

  const system = (
    id: string,
    order: number,
  ): Omit<RenderSystem, "init"> & { readonly init: (context: string) => void } => ({
    id,
    order,
    init: (context) => {
      calls.push(`${id}:init:${context}`);
    },
    update: () => {
      calls.push(`${id}:update`);
    },
    setQuality: (quality) => {
      calls.push(`${id}:${quality}`);
    },
    dispose: () => {
      calls.push(`${id}:dispose`);
    },
  });

  const scheduler = createScheduler(
    [
      system("debug", 110),
      system("riders", 40),
      system("environment", 10),
      system("camera", 80),
      system("road", 20),
    ],
    "scene",
  );

  scheduler.update(FRAME);
  scheduler.setQuality("low");
  scheduler.dispose();
  scheduler.dispose();
  scheduler.update(FRAME);
  scheduler.setQuality("high");

  expect(calls).toEqual([
    ...EXPECTED_ORDER.map((id) => `${id}:init:scene`),
    ...EXPECTED_ORDER.map((id) => `${id}:update`),
    ...EXPECTED_ORDER.map((id) => `${id}:low`),
    ...EXPECTED_ORDER.toReversed().map((id) => `${id}:dispose`),
  ]);
});

it("cleans up partially initialized systems if initialization fails", () => {
  const disposed: string[] = [];

  const first = {
    id: "first",
    order: 10,
    init() {},
    update() {},
    setQuality() {},
    dispose() {
      disposed.push("first");
    },
  };

  const failed = {
    ...first,
    id: "failed",
    order: 20,
    init() {
      throw new Error("GPU allocation failed");
    },
    dispose() {
      disposed.push("failed");
    },
  };

  expect(() => createScheduler([first, failed], "scene")).toThrow("GPU allocation failed");
  expect(disposed).toEqual(["failed", "first"]);
});

it("keeps one explicit monotonic quality table without automatic tuning", () => {
  expect(Object.values(QUALITY_SETTINGS).map((quality) => quality.pixelRatio)).toEqual([
    1, 1.25, 1.5, 2,
  ]);
  expect(QUALITY_SETTINGS.low.shadows).toBe(false);
  expect(QUALITY_SETTINGS.medium.shadows).toBe(true);
});
