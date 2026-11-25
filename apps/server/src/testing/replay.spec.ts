import {
  applyJournalEntry,
  createEngine,
  createRoute,
  PHYSICS_REVISION,
  projectReplaySnapshot,
  TEST_LOOP,
  type Engine,
} from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  RecordingV2Schema,
  ReplayEventV2Schema,
  type RecordingEntryV2,
  type RecordingV2,
  type ReplayObservationV2,
  type WindowFailure,
} from "@voltonaut/shared";

import { assessRecordingV2, type RecordingV2Assessment } from "../rides/replay.js";

export function replayEngine(): Engine {
  return createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE });
}

export function recordReplay(entries: readonly RecordingEntryV2[], clockScale = 1): RecordingV2 {
  const live = replayEngine();
  const observations: ReplayObservationV2[] = [];
  const events: ReplayObservationV2["events"][number][] = [];
  const commands: ReplayObservationV2["commands"][number][] = [];

  for (const entry of entries) {
    applyJournalEntry(live, entry, clockScale);

    if (entry[2] === "boundary") {
      observations.push({
        boundarySeq: entry[0],
        snapshot: projectReplaySnapshot(live.snapshot()),
        events: [...events],
        commands: [...commands],
        gap: false,
      });
      events.length = 0;
      commands.length = 0;
    }

    for (const event of live.drainEvents()) events.push(ReplayEventV2Schema.parse(event));

    for (const command of live.drainCommands()) commands.push(command);
  }

  return RecordingV2Schema.parse({
    schemaVersion: 2,
    rideId: "12345678-1234-4234-8234-123456789abc",
    initializedAt: "2026-11-20T12:00:00.000Z",
    initialization: {
      physicsRevision: PHYSICS_REVISION,
      routeId: "test-loop",
      routeRevision: "1",
      profile: DEFAULT_RIDER_PROFILE,
      source: "ble",
      clockScale,
      workerTimeOriginMs: 1795176000000,
      initializedWorkerMs: 0,
    },
    journalState: "complete",
    entries,
    window: { startSeq: observations[0]?.boundarySeq, finishSeq: observations.at(-1)?.boundarySeq },
    observations,
  });
}

export function normalReplay(): RecordingV2 {
  return recordReplay([
    [0, 0, "arm"],
    [1, 0, "status", "trainer", "ready"],
    [2, 0, "trainer", 250, 90, null],
    [3, 0, "boundary", "start"],
    [4, 1000, "advance", 1],
    [5, 1000, "boundary", "finish"],
  ]);
}

export function warmupReplay(): RecordingV2 {
  return recordReplay([
    [0, 0, "arm"],
    [1, 0, "status", "trainer", "ready"],
    [2, 0, "trainer", 250, 90, null],
    [3, 1000, "advance", 1],
    [4, 1000, "trainer", 300, 80, null],
    [5, 1000, "boundary", "start"],
    [6, 2000, "advance", 1],
    [7, 2000, "boundary", "finish"],
  ]);
}

export function replayed(
  ride: RecordingV2,
): Extract<RecordingV2Assessment, { readonly status: "replayed" }> {
  const result = assessRecordingV2(ride);

  if (result.status !== "replayed") throw new Error(JSON.stringify(result));

  return result;
}

export function windowFailures(ride: RecordingV2): readonly WindowFailure[] {
  const window = replayed(ride).source.window;

  return window.kind === "continuous" ? [] : window.reasons;
}
