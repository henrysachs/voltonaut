import {
  createEngine,
  createRoute,
  TEST_LOOP,
  type Engine,
  type RideSnapshot,
} from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  RecordingV2Schema,
  ReplayEventV2Schema,
  type RecordingEntryV2,
  type RecordingV2,
  type ReplayObservationV2,
} from "@voltonaut/shared";

import { assessRecordingV2, type RecordingV2Assessment } from "../rides/replay.js";

export function replayEngine(): Engine {
  return createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE });
}

function claim(snapshot: RideSnapshot): ReplayObservationV2["snapshot"] {
  const {
    worldPos: _worldPos,
    headingRad: _heading,
    trainerMode: _mode,
    gear,
    hrBpm,
    ...rest
  } = snapshot;

  return { ...rest, gearIndex: gear.index, gearRatio: gear.ratio, hrBpm: hrBpm ?? null };
}

interface TrainerNotification {
  type: "trainer.data";
  tS: number;
  powerW?: number;
  cadenceRpm?: number;
  speedMps?: number;
}

function applyLive(live: Engine, entry: RecordingEntryV2, clockScale: number): void {
  if (entry[2] === "trainer") {
    const event: TrainerNotification = { type: "trainer.data", tS: -999 };

    if (entry[3] !== null) event.powerW = entry[3];

    if (entry[4] !== null) event.cadenceRpm = entry[4];

    if (entry[5] !== null) event.speedMps = entry[5];
    live.ingest(event);
  } else if (entry[2] === "hr") {
    live.ingest({ type: "hr.data", tS: 999, bpm: entry[3] });
  } else if (entry[2] === "shift") {
    live.ingest({
      type: "controller.button",
      tS: 0,
      button: entry[3],
      pressed: true,
      source: "synthetic",
    });
  } else if (entry[2] === "advance") {
    live.advance(entry[3] * clockScale);
  }
}

export function recordReplay(entries: readonly RecordingEntryV2[], clockScale = 1): RecordingV2 {
  const live = replayEngine();
  const observations: ReplayObservationV2[] = [];
  const events: ReplayObservationV2["events"][number][] = [];
  const commands: ReplayObservationV2["commands"][number][] = [];

  for (const entry of entries) {
    applyLive(live, entry, clockScale);

    if (entry[2] === "boundary") {
      observations.push({
        boundarySeq: entry[0],
        snapshot: claim(live.snapshot()),
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
      physicsRevision: "engine-v1",
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
    [1, 0, "boundary", "start"],
    [2, 0, "status", "trainer", "ready"],
    [3, 0, "trainer", 250, 90, null],
    [4, 1000, "advance", 1],
    [5, 1000, "boundary", "finish"],
  ]);
}

export function replayed(
  ride: RecordingV2,
): Extract<RecordingV2Assessment, { readonly status: "replayed" }> {
  const result = assessRecordingV2(ride);

  if (result.status !== "replayed") throw new Error(JSON.stringify(result));

  return result;
}
