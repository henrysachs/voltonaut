import { expect, it } from "vitest";
import { createEngine, createRoute, FLAT_LOOP } from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  type CapturedRide,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";

import type { EngineWorkerResponse } from "./engineWorkerCore.js";
import type { EngineLink, EngineLinkInit, EngineUpdate } from "./engine-link.js";
import { createEngineLink } from "./engine-link.js";
import { localRide } from "../sync/testdata/localRide.js";
import type { CaptureView } from "./rideCaptureProtocol.js";
import { createFakePort } from "./testdata/enginePort.js";
import { TEST_LOOP_PATH } from "./testdata/recordedRideHarness.js";

const profile = DEFAULT_RIDER_PROFILE;
const snapshot = createEngine({ route: createRoute(FLAT_LOOP), profile }).snapshot();
const idle = { kind: "idle", availability: { kind: "journal" } } satisfies CaptureView;
const init = { worldPath: TEST_LOOP_PATH, profile, source: "sim" } satisfies EngineLinkInit;

const progress = {
  schemaVersion: 1,
  journalId: "550e8400-e29b-41d4-a716-446655440000",
  sequence: 0,
  startTick: 0,
  endTick: 1,
  startedAtMs: 0,
  endedAtMs: 50,
  source: "sim",
  clockScale: 1,
  physicsRevision: "engine-v1",
  worldId: "test-loop",
  worldRevision: "1",
  pathId: "test-loop",
  physics: { massKg: 75, bikeMassKg: 8, cdaM2: 0.32, crr: 0.004, wheelCircM: 2.105 },
  facts: [
    { powerW: 200, cadenceRpm: 90, timeS: 0.05, distanceM: 1, elevationGainM: 0, energyKj: 0.01 },
  ],
  quality: { paused: false, dataAgeS: 0, clockSkipped: false },
} satisfies RideProgressCheckpoint;

const recording = {
  kind: "recording",
  rideId: "id-2",
  elapsedMs: 0,
  availability: { kind: "journal" },
} satisfies CaptureView;

const completed = {
  kind: "completed",
  rideId: "id-2",
  availability: { kind: "journal" },
} satisfies CaptureView;

const capture: CapturedRide = {
  kind: "local_only",
  reason: "journal_age",
  track: {
    rideId: localRide.rideId,
    startedAt: localRide.startedAt,
    metadata: localRide.metadata,
    samples: localRide.samples,
  },
};

function setup() {
  const fake = createFakePort();
  let ids = 0;

  const link = createEngineLink(fake.port, init, {}, () => {
    ids += 1;

    return `id-${ids}`;
  });

  fake.deliver({
    type: "engine.update",
    actorId: "id-1",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });

  return { ...fake, link };
}

it("sends frozen initialization and ignores stale actor snapshots", () => {
  const { link, sent, deliver } = setup();
  expect(sent[0]).toEqual({
    type: "engine.init",
    actorId: "id-1",
    source: "sim",
    worldPath: TEST_LOOP_PATH,
    profile,
    clockScale: 1,
  });
  link.ingest({ type: "trainer.data", tS: 1, powerW: 200 });
  expect(sent[1]).toMatchObject({ type: "engine.ingest", actorId: "id-1" });
  deliver({
    type: "engine.update",
    actorId: "old",
    snapshot: { ...snapshot, tS: 999 },
    events: [],
    commands: [],
    recording: idle,
  });
  expect(link.latestSnapshot()?.tS).toBe(0);
});

it("sends initialization before any message, even before the first worker reply", () => {
  const fake = createFakePort();
  const link = createEngineLink(fake.port, init, {}, () => "actor");

  link.ingest({ type: "trainer.data", tS: 1, powerW: 200 });
  link.setMode("fun");
  expect(fake.sent.map((message) => message.type)).toEqual([
    "engine.init",
    "engine.ingest",
    "engine.setMode",
  ]);
  expect(new Set(fake.sent.map((message) => message.actorId))).toEqual(new Set(["actor"]));
});

it("hands each update whole to onUpdate after the snapshot is readable, not on recording replies", async () => {
  const fake = createFakePort();
  const seen: { readonly tS: number | undefined; readonly update: EngineUpdate }[] = [];

  const link: EngineLink = createEngineLink(
    fake.port,
    init,
    {
      onUpdate: (update) => {
        seen.push({ tS: link.latestSnapshot()?.tS, update });
      },
    },
    () => "actor",
  );

  const update = {
    type: "engine.update",
    actorId: "actor",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  } satisfies EngineWorkerResponse;

  fake.deliver(update);
  fake.deliver({ ...update, snapshot: { ...snapshot, tS: 2 }, progress: undefined });
  fake.deliver({ ...update, progress });
  const start = link.recording.start();
  fake.deliver({
    type: "recording.reply",
    actorId: "actor",
    requestId: 1,
    result: { kind: "state", view: recording },
  });
  await start;
  expect(seen.map((entry) => entry.tS)).toEqual([0, 2, 0]);
  expect(seen.map((entry) => entry.update.progress)).toEqual([undefined, undefined, progress]);
  expect(seen[0]?.update).toMatchObject({ events: [], commands: [] });
});

it("reports a worker failure once and drops later updates", () => {
  const fake = createFakePort();
  const failures: string[] = [];
  let updates = 0;

  createEngineLink(
    fake.port,
    init,
    {
      onUpdate: () => {
        updates += 1;
      },
      onFailure: (message) => {
        failures.push(message);
      },
    },
    () => "actor",
  );

  fake.fail("crashed");
  fake.deliver({
    type: "engine.update",
    actorId: "actor",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  expect(failures).toEqual(["crashed"]);
  expect(updates).toBe(0);
});

it("correlates recording acknowledgements and ignores duplicate and late replies", async () => {
  const { link, sent, deliver } = setup();
  const start = link.recording.start();
  expect(sent[1]).toEqual({
    type: "recording.command",
    actorId: "id-1",
    requestId: 1,
    command: { kind: "start", rideId: "id-2" },
  });

  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 1,
    result: { kind: "state", view: recording },
  });
  await start;
  const finish = link.recording.finish();

  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 2,
    result: { kind: "finished", capture, view: completed },
  });
  expect(await finish).toBe(capture);
  const release = link.recording.release("id-2");
  deliver({
    type: "recording.reply",
    actorId: "old",
    requestId: 3,
    result: { kind: "state", view: recording },
  });
  expect(link.recording.state()).toEqual(completed);
  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 3,
    result: { kind: "state", view: idle },
  });
  await release;
  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 2,
    result: { kind: "finished", capture, view: completed },
  });
  expect(link.recording.state()).toEqual(idle);
});

it("rejects pending requests on worker error and ignores later successes", async () => {
  const { link, fail, deliver } = setup();
  const start = link.recording.start();
  const rejected = start.catch((cause: unknown) => cause);
  fail("broken");
  expect(await rejected).toEqual(new Error("broken"));
  deliver({
    type: "engine.update",
    actorId: "id-1",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  expect(link.recording.state()).toEqual({ kind: "unavailable", message: "broken" });
  await expect(link.recording.start()).rejects.toThrow("nicht verfügbar");
});

it("settles pending requests on init failure and disposal", async () => {
  const { link, deliver, sent } = setup();
  const start = link.recording.start();
  const rejected = start.catch((cause: unknown) => cause);
  link.dispose();
  expect(await rejected).toEqual(new Error("Engine geschlossen."));
  expect(sent.at(-1)).toEqual({ type: "engine.dispose", actorId: "id-1" });
  deliver({
    type: "engine.update",
    actorId: "id-1",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  expect(link.recording.state().kind).toBe("unavailable");
  const next = setup();
  const pending = next.link.recording.start();
  const failed = pending.catch((cause: unknown) => cause);
  next.deliver({ type: "engine.initFailed", actorId: "id-1", message: "bad initialization" });
  expect(await failed).toEqual(new Error("bad initialization"));
});
