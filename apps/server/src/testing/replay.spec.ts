import {
  applyJournalEntry,
  createEngine,
  createRoute,
  PHYSICS_REVISION,
  projectReplaySnapshot,
  TEST_ROUTES,
  WORLDS,
  worldPathRoute,
  type Engine,
  type RouteData,
} from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  isWorldPathReference,
  RecordingV2Schema,
  ReplayEventV2Schema,
  type RecordingEntryV2,
  type RecordingV2,
  type ReplayObservationV2,
  type RideReference,
  type WindowFailure,
} from "@voltonaut/shared";

import { assessRecordingV2, type RecordingV2Assessment } from "../rides/replay.js";

function replayEngineOf(routeData: RouteData | undefined, label: string): Engine {
  if (routeData === undefined) throw new RangeError(`unknown replay route ${label}`);

  return createEngine({ route: createRoute(routeData), profile: DEFAULT_RIDER_PROFILE });
}

export function replayEngine(routeId = "test-loop"): Engine {
  return replayEngineOf(TEST_ROUTES[routeId], routeId);
}

/** The engine of the exact world revision a world path names; unknown references ride the test loop. */
function referencedEngine(reference: RideReference): Engine {
  const known = isWorldPathReference(reference)
    ? worldPathRoute(WORLDS, reference)
    : TEST_ROUTES[reference.routeId];

  return known === undefined ? replayEngine() : replayEngineOf(known, "reference");
}

/** The world path every new client ride references (ADR-033 §7). */
export const TEST_LOOP_WORLD_PATH = {
  worldId: "test-loop",
  worldRevision: "1",
  pathId: "test-loop",
} as const;

/** The single-route reference of stored rides from before worlds (ADR-033 §8). */
export const TEST_LOOP_ROUTE = { routeId: "test-loop", routeRevision: "1" } as const;

export function recordReplay(
  entries: readonly RecordingEntryV2[],
  clockScale = 1,
  reference: RideReference = TEST_LOOP_WORLD_PATH,
): RecordingV2 {
  const live = referencedEngine(reference);
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
      ...reference,
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

export function normalReplay(reference: RideReference = TEST_LOOP_WORLD_PATH): RecordingV2 {
  return recordReplay(
    [
      [0, 0, "arm"],
      [1, 0, "status", "trainer", "ready"],
      [2, 0, "trainer", 250, 90, null],
      [3, 0, "boundary", "start"],
      [4, 1000, "advance", 1],
      [5, 1000, "boundary", "finish"],
    ],
    1,
    reference,
  );
}

export function warmupReplay(reference: RideReference = TEST_LOOP_WORLD_PATH): RecordingV2 {
  return recordReplay(
    [
      [0, 0, "arm"],
      [1, 0, "status", "trainer", "ready"],
      [2, 0, "trainer", 250, 90, null],
      [3, 1000, "advance", 1],
      [4, 1000, "trainer", 300, 80, null],
      [5, 1000, "boundary", "start"],
      [6, 2000, "advance", 1],
      [7, 2000, "boundary", "finish"],
    ],
    1,
    reference,
  );
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
