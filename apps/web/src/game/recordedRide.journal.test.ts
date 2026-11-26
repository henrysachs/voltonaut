import { expect, it } from "vitest";
import {
  MAX_LOCAL_RIDE_MS,
  archivedRideTrack,
  projectRecordingTrack,
  RecordingV2Schema,
  serializeRideTcx,
  type DeviceEvent,
} from "@voltonaut/shared";

import type { CaptureCommand } from "./rideCaptureProtocol.js";
import {
  createRideHarness,
  finishedCapture,
  FIRST_RIDE_ID,
  journalCapture,
  localCapture,
  SECOND_RIDE_ID,
} from "./testdata/recordedRideHarness.js";

/** A ride armed at 0 ms with a ready trainer at 200 W / 90 rpm, addressed by absolute times. */
function setup() {
  const run = createRideHarness({
    timeOriginMs: Date.parse("2026-11-20T12:00:00.000Z"),
  });

  run.arm();

  const ingest = (event: DeviceEvent, atMs: number) => {
    run.advanceTo(atMs);
    run.ingest(event);
  };

  ingest({ type: "device.status", tS: 999, kind: "trainer", id: "trainer", status: "ready" }, 0);
  ingest({ type: "trainer.data", tS: 999, powerW: 200, cadenceRpm: 90 }, 0);

  return {
    ingest,
    snapshot: () => run.latest().snapshot,
    view: () => run.latest().recording,
    advance: (atMs: number) => {
      run.advanceTo(atMs);
      run.wake();
    },
    command: (kind: CaptureCommand["kind"], atMs: number, rideId = FIRST_RIDE_ID) => {
      run.advanceTo(atMs);

      return run.capture(kind, rideId);
    },
  };
}

it("keeps warm physics and real UTC while the selected track starts at zero", () => {
  const run = setup();
  run.advance(1000);
  const baseline = run.snapshot().distanceM;
  expect(run.command("start", 1000).kind).toBe("state");
  run.advance(2000);
  const capture = journalCapture(run.command("finish", 2250));
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
  expect(track.samples.at(-1)?.distanceM).toBeCloseTo(run.snapshot().distanceM - baseline, 12);
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
  const first = journalCapture(run.command("finish", 1000));
  expect(run.command("start", 1000, SECOND_RIDE_ID).kind).toBe("failed");
  expect(run.command("release", 1000, SECOND_RIDE_ID).kind).toBe("failed");
  run.advance(2000);
  expect(run.view()).toMatchObject({ kind: "completed", rideId: FIRST_RIDE_ID });
  expect(run.command("release", 2000).kind).toBe("state");
  run.command("start", 2000, SECOND_RIDE_ID);
  run.advance(3000);
  const second = journalCapture(run.command("finish", 3000, SECOND_RIDE_ID));
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
  run.command("start", 1000, SECOND_RIDE_ID);
  expect(run.command("discard", 1000).kind).toBe("failed");
  expect(run.command("finish", 2000).kind).toBe("failed");
  run.advance(2000);
  const capture = journalCapture(run.command("finish", 2000, SECOND_RIDE_ID));
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
  const track = archivedRideTrack(finishedCapture(run.command("finish", 3500)));
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
  expect(run.snapshot().powerW).toBeGreaterThan(2000);
  const capture = localCapture(run.command("finish", 2000));
  expect(capture.reason).toBe("invalid_input");
  expect(capture.track.samples.at(-1)?.powerW).toBeUndefined();
  expect(capture.track.samples.at(-1)?.cadenceRpm).toBe(80);
  run.command("release", 2000);
  run.ingest({ type: "trainer.data", tS: 0, powerW: 0, cadenceRpm: 0 }, 2000);
  run.command("start", 2000, SECOND_RIDE_ID);
  run.advance(3000);
  expect(run.command("finish", 3000, SECOND_RIDE_ID)).toMatchObject({
    kind: "finished",
    capture: { kind: "local_only", reason: "invalid_input" },
  });
});

it("keeps future windows local after the lifetime horizon, without resetting the running engine", () => {
  const run = setup();
  run.advance(MAX_LOCAL_RIDE_MS + 1);
  const tS = run.snapshot().tS;
  run.ingest({ type: "trainer.data", tS: 0, powerW: 0, cadenceRpm: 0 }, MAX_LOCAL_RIDE_MS + 1);
  run.command("start", MAX_LOCAL_RIDE_MS + 1);
  run.advance(MAX_LOCAL_RIDE_MS + 1001);
  const result = run.command("finish", MAX_LOCAL_RIDE_MS + 1001);
  expect(result).toMatchObject({
    kind: "finished",
    capture: { kind: "local_only", reason: "journal_age" },
  });
  expect(run.snapshot().tS).toBeGreaterThan(tS);
});

it("invalidates only the bad raw channel, preserving an omitted but still fresh counterpart", () => {
  const run = setup();
  run.command("start", 0);
  run.ingest({ type: "trainer.data", tS: 0, powerW: 2500 }, 1000);
  run.advance(2000);
  const capture = localCapture(run.command("finish", 2000));
  expect(capture.reason).toBe("invalid_input");
  expect(capture.track.samples.at(-1)).toMatchObject({ cadenceRpm: 90, gap: true });
  expect(capture.track.samples.at(-1)?.powerW).toBeUndefined();
});

it("rejects a long window without trainer data as empty and keeps it discardable", () => {
  const run = setup();
  run.ingest(
    { type: "device.status", tS: 0, kind: "trainer", id: "trainer", status: "disconnected" },
    0,
  );
  run.command("start", 0);
  run.advance(1000);
  run.advance(2000);
  const result = run.command("finish", 2500);
  expect(result).toMatchObject({
    kind: "failed",
    message: "Aufnahme leer oder ungültig. Mindestens eine Sekunde mit Trainerdaten aufnehmen.",
    view: { kind: "recording" },
  });
  expect(run.command("discard", 2500).kind).toBe("state");
});

it("rejects early/overlong completion without freeing active data", () => {
  const run = setup();
  run.command("start", 0);
  expect(run.command("finish", 999).kind).toBe("failed");
  const overlong = run.command("finish", MAX_LOCAL_RIDE_MS + 1);
  expect(overlong.kind).toBe("failed");
  expect(overlong.view.kind).toBe("recording");
  expect(run.command("discard", MAX_LOCAL_RIDE_MS + 1).kind).toBe("state");
});
