import { expect, it } from "vitest";
import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  MAX_LOCAL_RIDE_MS,
  archivedRideTrack,
  projectRecordingTrack,
  RecordingV2Schema,
  serializeRideTcx,
  type DeviceEvent,
} from "@voltonaut/shared";

import { createRideRecorder } from "./rideRecorder.js";
import type { CaptureResult } from "./rideCaptureProtocol.js";

const firstId = "550e8400-e29b-41d4-a716-446655440000";
const secondId = "550e8400-e29b-41d4-a716-446655440001";

function setup() {
  const initialization = {
    initializedAt: "2026-11-20T12:00:00.000Z",
    initialization: {
      physicsRevision: "engine-v1",
      routeId: "test-loop",
      routeRevision: "1",
      profile: DEFAULT_RIDER_PROFILE,
      source: "sim",
      clockScale: 1,
      workerTimeOriginMs: Date.parse("2026-11-20T12:00:00.000Z"),
      initializedWorkerMs: 0,
    },
  } satisfies Parameters<typeof createRideRecorder>[0];

  const recorder = createRideRecorder(initialization);
  const engine = createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE });
  let wakeMs = 0;
  recorder.arm(0);

  function ingest(event: DeviceEvent, atMs: number) {
    recorder.ingest(event, atMs);
    engine.ingest(event);
  }

  function advance(atMs: number) {
    recorder.advance(atMs, (atMs - wakeMs) / 1000);
    engine.advance((atMs - wakeMs) / 1000);
    wakeMs = atMs;
    recorder.outputs(engine.drainEvents(), engine.drainCommands());
    recorder.sample(atMs, engine.snapshot());
  }

  ingest({ type: "device.status", tS: 999, kind: "trainer", id: "trainer", status: "ready" }, 0);
  ingest({ type: "trainer.data", tS: 999, powerW: 200, cadenceRpm: 90 }, 0);

  return {
    recorder,
    engine,
    ingest,
    advance,
    command: (kind: "start" | "finish" | "release" | "discard", atMs: number, rideId = firstId) =>
      recorder.command({ kind, rideId }, atMs, engine.snapshot()),
  };
}

function finished(result: CaptureResult) {
  if (result.kind !== "finished") throw new Error("Expected finished capture");

  return result.capture;
}

function journal(result: CaptureResult) {
  const capture = finished(result);

  if (capture.kind !== "journal") throw new Error("Expected complete journal");

  return capture;
}

function local(result: CaptureResult) {
  const capture = finished(result);

  if (capture.kind !== "local_only") throw new Error("Expected local-only capture");

  return capture;
}

it("keeps warm physics and real UTC while the selected track starts at zero", () => {
  const run = setup();
  run.advance(1000);
  const baseline = run.engine.snapshot().distanceM;
  expect(run.command("start", 1000).kind).toBe("state");
  run.advance(2000);
  const capture = journal(run.command("finish", 2250));
  const recording = capture.recording;
  expect(RecordingV2Schema.safeParse(recording).success).toBe(true);
  const track = projectRecordingTrack(recording);
  expect(track.startedAt).toBe("2026-11-20T12:00:01.000Z");
  expect(track.samples[0]).toMatchObject({
    elapsedMs: 0,
    distanceM: 0,
    powerW: 200,
    cadenceRpm: 90,
  });
  expect(track.samples.at(-1)?.elapsedMs).toBe(1250);
  expect(track.samples.at(-1)?.distanceM).toBeCloseTo(
    run.engine.snapshot().distanceM - baseline,
    12,
  );
  expect(
    recording.entries.slice(0, recording.window.startSeq).some((entry) => entry[2] === "advance"),
  ).toBe(true);
  expect(recording.observations[0]?.events[0]).toEqual({ type: "ride.started" });
  expect(serializeRideTcx(archivedRideTrack(capture))).toBe(serializeRideTcx(track));
});

it("retains completion until matching release, and projects only the chosen second window", () => {
  const run = setup();
  run.command("start", 0);
  run.advance(1000);
  const first = journal(run.command("finish", 1000));
  expect(run.command("start", 1000, secondId).kind).toBe("failed");
  expect(run.command("release", 1000, secondId).kind).toBe("failed");
  run.advance(2000);
  expect(run.recorder.view(2000)).toMatchObject({ kind: "completed", rideId: firstId });
  expect(run.command("release", 2000).kind).toBe("state");
  run.command("start", 2000, secondId);
  run.advance(3000);
  const second = journal(run.command("finish", 3000, secondId));
  expect(
    second.recording.entries.filter((entry) => entry[2] === "boundary").map((entry) => entry[3]),
  ).toEqual(["start", "sample", "finish"]);
  expect(
    second.recording.entries
      .filter((entry) => entry[2] !== "boundary")
      .slice(0, 4)
      .map((entry) => entry.slice(1)),
  ).toEqual(
    first.recording.entries
      .filter((entry) => entry[2] !== "boundary")
      .map((entry) => entry.slice(1)),
  );
  expect(projectRecordingTrack(second.recording).samples[0]?.distanceM).toBe(0);
  expect(second.recording.observations[0]?.events[0]).toEqual({ type: "ride.started" });
  expect(run.command("discard", 3000).kind).toBe("failed");
});

it("manual discard removes no physics and stale ride commands cannot alter another window", () => {
  const run = setup();
  run.command("start", 0);
  run.advance(1000);
  run.command("discard", 1000);
  run.command("start", 1000, secondId);
  expect(run.command("discard", 1000).kind).toBe("failed");
  expect(run.command("finish", 2000).kind).toBe("failed");
  run.advance(2000);
  const capture = journal(run.command("finish", 2000, secondId));
  expect(capture.recording.entries.filter((entry) => entry[2] === "advance")).toHaveLength(2);
  expect(
    capture.recording.entries.filter((entry) => entry[2] === "boundary").map((entry) => entry[3]),
  ).toEqual(["start", "sample", "finish"]);
});

it("preserves per-field raw freshness, partials, zero and disconnect omissions", () => {
  const run = setup();
  run.ingest({ type: "hr.data", tS: 999, bpm: 120 }, 0);
  run.command("start", 0);
  run.ingest({ type: "trainer.data", tS: 999, cadenceRpm: 0 }, 1000);
  run.advance(1000);
  run.ingest({ type: "trainer.data", tS: 999, powerW: 0 }, 2000);
  run.advance(2000);
  run.advance(3000);
  run.ingest(
    { type: "device.status", tS: 0, kind: "heartRate", id: "hr", status: "disconnected" },
    3000,
  );
  run.ingest(
    { type: "device.status", tS: 0, kind: "trainer", id: "t", status: "disconnected" },
    3000,
  );
  const track = archivedRideTrack(finished(run.command("finish", 3500)));
  expect(track.samples[1]).toMatchObject({ powerW: 200, cadenceRpm: 0, hrBpm: 120 });
  expect(track.samples[2]).toMatchObject({ powerW: 0, cadenceRpm: 0 });
  expect(track.samples[3]?.hrBpm).toBeUndefined();
  expect(track.samples.at(-1)).toMatchObject({ gap: true });
  expect(track.samples.at(-1)?.powerW).toBeUndefined();
  expect(track.samples.at(-1)?.cadenceRpm).toBeUndefined();
});

it("omits invalid capture channels without clamping the real engine, permanently local for this epoch", () => {
  const run = setup();
  run.command("start", 0);
  run.ingest({ type: "trainer.data", tS: 0, powerW: 2500, cadenceRpm: 80 }, 1000);
  run.advance(2000);
  expect(run.engine.snapshot().powerW).toBeGreaterThan(2000);
  const capture = local(run.command("finish", 2000));
  expect(capture.reason).toBe("invalid_input");
  expect(capture.track.samples.at(-1)?.powerW).toBeUndefined();
  expect(capture.track.samples.at(-1)?.cadenceRpm).toBe(80);
  run.command("release", 2000);
  run.ingest({ type: "trainer.data", tS: 0, powerW: 0, cadenceRpm: 0 }, 2000);
  run.command("start", 2000, secondId);
  run.advance(3000);
  expect(run.command("finish", 3000, secondId)).toMatchObject({
    kind: "finished",
    capture: { kind: "local_only", reason: "invalid_input" },
  });
});

it("keeps future windows local after the lifetime horizon, without resetting the running engine", () => {
  const run = setup();
  run.advance(MAX_LOCAL_RIDE_MS + 1);
  const tS = run.engine.snapshot().tS;
  run.ingest({ type: "trainer.data", tS: 0, powerW: 0, cadenceRpm: 0 }, MAX_LOCAL_RIDE_MS + 1);
  run.command("start", MAX_LOCAL_RIDE_MS + 1);
  run.advance(MAX_LOCAL_RIDE_MS + 1001);
  const result = run.command("finish", MAX_LOCAL_RIDE_MS + 1001);
  expect(result).toMatchObject({
    kind: "finished",
    capture: { kind: "local_only", reason: "journal_age" },
  });
  expect(run.engine.snapshot().tS).toBeGreaterThan(tS);
});

it("invalidates only the bad raw channel, preserving an omitted but still fresh counterpart", () => {
  const run = setup();
  run.command("start", 0);
  run.ingest({ type: "trainer.data", tS: 0, powerW: 2500 }, 1000);
  run.advance(2000);
  const capture = local(run.command("finish", 2000));
  expect(capture.reason).toBe("invalid_input");
  expect(capture.track.samples.at(-1)).toMatchObject({ cadenceRpm: 90, gap: true });
  expect(capture.track.samples.at(-1)?.powerW).toBeUndefined();
});

it("rejects early/overlong completion without freeing active data", () => {
  const run = setup();
  run.command("start", 0);
  expect(run.command("finish", 999).kind).toBe("failed");
  expect(run.command("finish", MAX_LOCAL_RIDE_MS + 1).kind).toBe("failed");
  expect(run.recorder.view(MAX_LOCAL_RIDE_MS + 1).kind).toBe("recording");
  expect(run.command("discard", MAX_LOCAL_RIDE_MS + 1).kind).toBe("state");
});
