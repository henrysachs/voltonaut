import type { WorldPathReference } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { TEST_LOOP } from "../elevation/data/test-loop.js";

import { TEST_WORLDS, WORLDS } from "./data/index.js";
import { worldPathRoute } from "./registry.js";

const TEST_LOOP_PATH = { worldId: "test-loop", worldRevision: "1", pathId: "test-loop" } as const;

it("resolves the test-loop world path field by field to the former route", () => {
  expect(worldPathRoute(TEST_WORLDS, TEST_LOOP_PATH)).toStrictEqual(TEST_LOOP);
});

it.each(TEST_WORLDS.map((world) => [world.id] as const))(
  "resolves the path of world %s within its own world only",
  (worldId) => {
    const route = worldPathRoute(TEST_WORLDS, { worldId, worldRevision: "1", pathId: worldId });

    expect(route?.id).toBe(worldId);
  },
);

it.each<WorldPathReference>([
  { ...TEST_LOOP_PATH, worldId: "flat-loop" },
  { ...TEST_LOOP_PATH, worldId: "unknown" },
  { ...TEST_LOOP_PATH, worldRevision: "2" },
  { ...TEST_LOOP_PATH, worldRevision: "" },
  { ...TEST_LOOP_PATH, pathId: "flat-loop" },
  { ...TEST_LOOP_PATH, pathId: "" },
])("rejects a reference that differs in one field: %o", (reference) => {
  expect(worldPathRoute(TEST_WORLDS, reference)).toBeUndefined();
});

it("finds nothing in an empty world list", () => {
  expect(worldPathRoute([], TEST_LOOP_PATH)).toBeUndefined();
});

it("resolves a voltonaut path only in its own world and revision", () => {
  const tour = { worldId: "voltonaut", worldRevision: "1", pathId: "voltonaut-tour" } as const;

  expect(worldPathRoute(WORLDS, tour)?.id).toBe("voltonaut-tour");
  expect(worldPathRoute(TEST_WORLDS, tour)).toBeUndefined();
});
