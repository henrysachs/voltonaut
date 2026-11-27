import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { ProgressCheckpointBatchSchema, type RideProgressCheckpoint } from "@voltonaut/shared";

import {
  createRideHarness,
  singleRouteWorldPath,
  TRAINER_READING,
} from "./testdata/recordedRideHarness.js";

function contractCheckpoint(): RideProgressCheckpoint {
  const contract = ProgressCheckpointBatchSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../../fixtures/api/progress-checkpoints.request.json", import.meta.url),
        "utf8",
      ),
    ),
  );

  const checkpoint = contract.checkpoints[0];

  if (checkpoint === undefined) throw new Error("Expected a progress contract checkpoint");

  return checkpoint;
}

it("posts rounded epoch timestamps from real ride output with a nonzero time origin", () => {
  const expected = contractCheckpoint();

  const run = createRideHarness({
    startMs: 0.4,
    timeOriginMs: expected.startedAtMs,
    init: { source: "ble", worldPath: singleRouteWorldPath("flat-loop") },
  });

  run.ingest(TRAINER_READING);
  run.arm();
  const update = run.wake(50.4);

  expect(update.progress).toMatchObject({
    startedAtMs: expected.startedAtMs,
    endedAtMs: expected.endedAtMs,
  });
  expect(update.progress?.startedAtMs).toBe(Math.round(expected.startedAtMs + 0.4));
  expect(update.progress?.endedAtMs).toBe(Math.round(expected.startedAtMs + 0.4 + 50.4));
  expect(Number.isSafeInteger(update.progress?.startedAtMs)).toBe(true);
  expect(Number.isSafeInteger(update.progress?.endedAtMs)).toBe(true);
});
