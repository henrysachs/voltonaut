import { expect, it } from "vitest";
import { DEFAULT_RIDER_PROFILE, MAX_LOCAL_RIDE_MS } from "@voltonaut/shared";

import { createRideRecorder } from "./rideRecorder.js";

function setup() {
  let nowMs = 100;

  const recorder = createRideRecorder({
    nowMs: () => nowMs,
    utcNow: () => "2026-11-20T12:00:00.000Z",
    newId: () => "550e8400-e29b-41d4-a716-446655440000",
    metadata: {
      source: "sim",
      routeId: "test-loop",
      routeRevision: "1",
      physicsClockScale: 1,
      profile: DEFAULT_RIDER_PROFILE,
    },
  });

  return {
    recorder,
    setTime: (value: number) => {
      nowMs = value;
    },
  };
}

it("uses a distance baseline and real monotonic time, preserving zero and missing readings", () => {
  const { recorder, setTime } = setup();
  recorder.ingest({ type: "trainer.data", tS: 999, powerW: 0, cadenceRpm: 0 });
  recorder.start(500);
  expect(() => {
    recorder.start(600);
  }).toThrow("bereits");
  setTime(1100);
  recorder.sample(510);
  const ride = recorder.finish(511);
  expect(ride.startedAt).toBe("2026-11-20T12:00:00.000Z");
  expect(ride.samples.map((sample) => sample.elapsedMs)).toEqual([0, 1000]);
  expect(ride.samples[1]).toMatchObject({ distanceM: 10, powerW: 0, cadenceRpm: 0 });
  expect(ride.samples[1]?.hrBpm).toBeUndefined();
  expect(() => recorder.finish(512)).toThrow("Keine laufende");
  recorder.start(1000);
  expect(recorder.state().kind).toBe("recording");
});

it("does not fabricate intermediate samples or stale sensor readings", () => {
  const { recorder, setTime } = setup();
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: 120 });
  recorder.start(0);
  setTime(10_100);
  recorder.sample(50);
  const ride = recorder.finish(50);
  expect(ride.samples).toHaveLength(2);
  expect(ride.samples[1]).toMatchObject({ elapsedMs: 10_000, gap: true });
  expect(ride.samples[1]?.powerW).toBeUndefined();
});

it("rejects empty, reverse, nonfinite and overlong captures", () => {
  const { recorder, setTime } = setup();
  recorder.start(0);
  expect(() => recorder.finish(0)).toThrow("leer oder ungültig");
  setTime(50);
  expect(() => {
    recorder.sample(1);
  }).toThrow("ungültig");
  setTime(1100);
  expect(() => {
    recorder.sample(Number.NaN);
  }).toThrow("ungültig");
  setTime(21_600_101);
  expect(() => recorder.finish(1)).toThrow("ungültig");
});

it("keeps fractional final seconds and rejects decreasing distance", () => {
  const { recorder, setTime } = setup();
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: 20, cadenceRpm: 30 });
  recorder.start(100);
  setTime(1100);
  recorder.sample(110);
  setTime(2100);
  expect(() => {
    recorder.sample(109);
  }).toThrow("rückwärts");
  setTime(2350);
  const ride = recorder.finish(115);
  expect(ride.samples.at(-1)).toMatchObject({ elapsedMs: 2250, distanceM: 15 });
});

it("clears disconnected sources and does not invent omitted fields", () => {
  const { recorder, setTime } = setup();
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: 20, cadenceRpm: 30 });
  recorder.ingest({ type: "hr.data", tS: 0, bpm: 120 });
  recorder.start(0);
  recorder.ingest({
    type: "device.status",
    tS: 0,
    kind: "heartRate",
    id: "hr",
    status: "disconnected",
  });
  recorder.ingest({
    type: "device.status",
    tS: 0,
    kind: "trainer",
    id: "trainer",
    status: "reconnecting",
  });
  setTime(1100);
  recorder.sample(1);
  recorder.ingest({ type: "trainer.data", tS: 0, cadenceRpm: 0 });
  setTime(2100);
  const ride = recorder.finish(2);
  expect(ride.samples[0]?.hrBpm).toBe(120);
  expect(ride.samples[1]?.powerW).toBeUndefined();
  expect(ride.samples[1]?.hrBpm).toBeUndefined();
  expect(ride.samples[2]?.powerW).toBeUndefined();
  expect(ride.samples[2]?.cadenceRpm).toBe(0);
});

it("rejects a capture with no trainer readings and a nonfinite baseline", () => {
  const { recorder, setTime } = setup();
  expect(() => {
    recorder.start(Number.POSITIVE_INFINITY);
  }).toThrow("gültiger Fahrtstand");
  recorder.start(0);
  setTime(1100);
  expect(() => recorder.finish(10)).toThrow("leer oder ungültig");
});

it("rejects nonfinite raw sensor data and nonfinite recording time with a usable message", () => {
  const { recorder, setTime } = setup();
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: Number.NaN });
  expect(() => {
    recorder.start(0);
  }).toThrow("Messwerte oder Zeit");
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: 0 });
  recorder.start(0);
  setTime(Number.POSITIVE_INFINITY);
  expect(() => {
    recorder.sample(1);
  }).toThrow("Zeit oder Distanz");
});

it("recovers from an overlong recording only after explicit discard, without leaking old samples", () => {
  const { recorder, setTime } = setup();
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: 20, cadenceRpm: 30 });
  recorder.start(0);
  setTime(1100);
  recorder.sample(10);
  setTime(100 + MAX_LOCAL_RIDE_MS + 1);
  expect(() => {
    recorder.sample(20);
  }).toThrow("Maximal 6 Stunden");
  expect(() => recorder.finish(20)).toThrow("Maximal 6 Stunden");
  expect(() => {
    recorder.start(20);
  }).toThrow("bereits");
  expect(recorder.state().kind).toBe("recording");
  recorder.discard();
  expect(recorder.state().kind).toBe("idle");
  recorder.ingest({ type: "trainer.data", tS: 0, powerW: 0, cadenceRpm: 0 });
  recorder.start(20);
  setTime(100 + MAX_LOCAL_RIDE_MS + 1001);
  const ride = recorder.finish(21);
  expect(ride.samples.map((point) => point.elapsedMs)).toEqual([0, 1000]);
  expect(ride.samples.map((point) => point.distanceM)).toEqual([0, 1]);
  recorder.discard();
  expect(recorder.state()).toEqual({ kind: "completed", ride });
});
