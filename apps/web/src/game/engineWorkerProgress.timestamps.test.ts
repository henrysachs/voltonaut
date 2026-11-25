import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  DEFAULT_RIDER_PROFILE,
  ProgressCheckpointBatchSchema,
  type DeviceEvent,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";

import { bindEngineWorker, type EngineWorkerResponse } from "./engineWorkerCore.js";
import {
  createFakeScope,
  createManualClock,
  createFakeTimers,
} from "./testdata/engineWorkerHarness.js";

const journalId = "550e8400-e29b-41d4-a716-446655440000";

const trainerReading = {
  type: "trainer.data",
  tS: 0,
  powerW: 200,
  cadenceRpm: 90,
} satisfies DeviceEvent;

type EngineUpdate = Extract<EngineWorkerResponse, { readonly type: "engine.update" }>;

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

function requireLatestUpdate(posted: readonly EngineWorkerResponse[]): EngineUpdate {
  const update = posted.findLast((message) => message.type === "engine.update");

  if (update === undefined || update.type !== "engine.update") {
    throw new Error("Expected an engine update");
  }

  return update;
}

it("posts rounded epoch timestamps from real worker output with a nonzero time origin", () => {
  const expected = contractCheckpoint();
  const fake = createFakeScope();
  const clock = createManualClock(0.4);
  const timers = createFakeTimers();

  bindEngineWorker(
    fake.scope,
    clock.nowMs,
    timers.schedule,
    timers.cancel,
    expected.startedAtMs,
    () => journalId,
  );
  fake.send({
    type: "engine.init",
    actorId: "actor",
    source: "ble",
    routeId: "flat-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  fake.send({ type: "engine.ingest", actorId: "actor", event: trainerReading });
  timers.tick();
  clock.advanceMs(50.4);
  timers.tick();

  const update = requireLatestUpdate(fake.posted);

  expect(update.progress).toMatchObject({
    startedAtMs: expected.startedAtMs,
    endedAtMs: expected.endedAtMs,
  });
  expect(update.progress?.startedAtMs).toBe(Math.round(expected.startedAtMs + 0.4));
  expect(update.progress?.endedAtMs).toBe(Math.round(expected.startedAtMs + 0.4 + 50.4));
  expect(Number.isSafeInteger(update.progress?.startedAtMs)).toBe(true);
  expect(Number.isSafeInteger(update.progress?.endedAtMs)).toBe(true);
});
