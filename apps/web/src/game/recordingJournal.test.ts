import { expect, it } from "vitest";
import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  MAX_RECORDING_V2_INPUTS,
  MAX_RECORDING_V2_BYTES,
  RecordingV2Schema,
} from "@voltonaut/shared";

import { RecordingJournal } from "./recordingJournal.js";
import type { JournalInitialization } from "./recordingJournal.js";

const initialization: JournalInitialization = {
  initializedAt: "2026-11-20T12:00:00.000Z",
  initialization: {
    physicsRevision: "engine-v1",
    worldId: "test-loop",
    worldRevision: "1",
    pathId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    source: "sim",
    clockScale: 1,
    workerTimeOriginMs: Date.parse("2026-11-20T12:00:00.000Z"),
    initializedWorkerMs: 0,
  },
};

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

const observation = {
  tS: 0,
  distanceM: 0,
  routePosM: 0,
  lap: 0,
  speedMps: 0,
  powerW: 0,
  cadenceRpm: 0,
  hrBpm: null,
  gradePct: 0,
  gearIndex: snapshot.gear.index,
  gearRatio: snapshot.gear.ratio,
  elevationGainM: 0,
  energyKj: 0,
  paused: false,
  dataAgeS: 0,
};

it("keeps full selected output envelopes below the UTF-8 byte limit", () => {
  const journal = new RecordingJournal(initialization);
  journal.append([0, 0, "arm"]);
  journal.start("550e8400-e29b-41d4-a716-446655440000");
  journal.boundary(0, "start", observation, false);

  for (let index = 0; index < 12_000; index += 1) {
    journal.outputs([{ type: "segment.entered", segmentId: "🚴".repeat(50), tS: index }], []);
  }

  journal.boundary(1000, "sample", observation, false);
  const recording = journal.finish();
  expect(recording).toBeDefined();
  expect(RecordingV2Schema.safeParse(recording).success).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(recording)).byteLength).toBeLessThan(
    MAX_RECORDING_V2_BYTES,
  );

  for (let index = 0; index < 24_000; index += 1) {
    journal.outputs([{ type: "segment.entered", segmentId: "🚴".repeat(50), tS: index }], []);
  }

  expect(journal.reason()).toBe("journal_bytes");
  expect(journal.finish()).toBeUndefined();
  journal.clearWindow();
  journal.start("550e8400-e29b-41d4-a716-446655440001");
  expect(journal.reason()).toBe("journal_bytes");
});

it("enforces input count incrementally across discarded windows", () => {
  const journal = new RecordingJournal(initialization);
  journal.append([0, 0, "arm"]);

  for (let index = 0; index < MAX_RECORDING_V2_INPUTS; index += 1) journal.append([0, 0, "hr", 80]);
  expect(journal.reason()).toBeUndefined();
  journal.start("550e8400-e29b-41d4-a716-446655440000");
  journal.clearWindow();
  journal.append([0, 0, "hr", 80]);
  expect(journal.reason()).toBe("journal_inputs");
});
