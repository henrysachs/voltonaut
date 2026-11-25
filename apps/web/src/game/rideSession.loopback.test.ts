import {
  createFakePlay,
  createFakeTrainer,
  createManualTicker,
  createSimScript,
} from "@voltonaut/ble";
import type { RideSnapshot } from "@voltonaut/engine";
import { createEventBus, DEFAULT_RIDER_PROFILE, type TrainerCommand } from "@voltonaut/shared";
import { expect, it } from "vitest";

import type { CaptureView } from "./rideCaptureProtocol.js";
import { createRideSession } from "./rideSession.js";
import { createLoopbackWorker } from "./testdata/loopbackWorker.js";

const SAMPLES = createSimScript([{ powerW: 250, cadenceRpm: 90, heartRateBpm: 130, gearIndex: 0 }]);

function requireSnapshot(snapshot: RideSnapshot | undefined): RideSnapshot {
  if (snapshot === undefined) throw new Error("Expected a worker snapshot");

  return snapshot;
}

function completedRideId(view: CaptureView): string {
  if (view.kind !== "completed") throw new Error(`Expected a completed capture, got ${view.kind}`);

  return view.rideId;
}

/** Sim devices on a manual ticker and the real worker driver behind the loopback port. */
async function ride() {
  const worker = createLoopbackWorker(1000, Date.parse("2026-11-25T08:00:00.000Z"));
  const bus = createEventBus();
  const ticker = createManualTicker();
  let simS = 0;
  const clock = { nowS: () => simS };
  const trainer = createFakeTrainer({ bus, clock, ticker, samples: SAMPLES });
  const play = createFakePlay({ bus, clock });
  const commands: TrainerCommand[] = [];

  const session = createRideSession(
    {
      bus,
      routeId: "test-loop",
      profile: DEFAULT_RIDER_PROFILE,
      source: "sim",
      clockScale: 1,
      trainer: {
        onSnapshot: () => {},
        onCommands: (batch) => {
          commands.push(...batch);
        },
      },
    },
    () => worker.port,
  );

  await Promise.all([trainer.connect(), play.connect()]);

  /** Rides for `seconds`: one trainer reading per 250 ms, the worker waking every 50 ms. */
  const pedal = (seconds: number): void => {
    for (let step = 0; step < seconds * 4; step += 1) {
      simS += 0.25;
      ticker.tick();
      worker.advanceMs(250);
    }
  };

  return { worker, session, play, commands, pedal };
}

it("turns sim device events into snapshots, segments and trainer commands without a browser", async () => {
  const { worker, session, play, commands, pedal } = await ride();

  worker.flush();
  expect(session.snapshot()?.tS).toBe(0);
  expect(session.connected()).toBe(true);
  pedal(10);

  const moving = requireSnapshot(session.snapshot());

  // The first wake arms the worker clock and advances nothing.
  expect(moving.tS).toBeCloseTo(9.95, 6);
  expect(moving.powerW).toBeCloseTo(250, 1);
  expect(moving.distanceM).toBeGreaterThan(30);
  expect(moving.speedMps).toBeGreaterThan(5);
  expect(session.segments().rows.map((row) => row.progress.kind)).toEqual(["idle", "idle"]);
  expect(commands.some((command) => command.type === "simulation")).toBe(true);

  play.pressShiftUp();
  pedal(1);
  expect(session.snapshot()?.gear.index).toBe(moving.gear.index + 1);
});

it("reports the engine's mode and keeps it normal when fun is requested during a recording", async () => {
  const { worker, session, pedal } = await ride();

  pedal(1);
  expect(session.mode()).toBe("normal");
  session.requestMode("fun");
  pedal(1);
  expect(session.mode()).toBe("fun");
  session.requestMode("normal");
  pedal(1);
  expect(session.mode()).toBe("normal");

  const started = session.recording.start();

  worker.flush();
  await started;
  expect(session.recording.state().kind).toBe("recording");
  session.requestMode("fun");
  pedal(1);
  expect(session.mode()).toBe("normal");
});

it("records a ride from start to finish and releases it", async () => {
  const { worker, session, pedal } = await ride();
  const updates: string[] = [];

  session.subscribe(() => {
    updates.push(session.recording.state().kind);
  });
  pedal(1);

  const started = session.recording.start();

  worker.flush();
  await started;
  pedal(5);

  const finished = session.recording.finish();

  worker.flush();
  const capture = await finished;

  const rideId = completedRideId(session.recording.state());

  expect(capture).toMatchObject({ kind: "journal", recording: { rideId } });

  const released = session.recording.release(rideId);

  worker.flush();
  await released;
  expect(session.recording.state().kind).toBe("idle");
  expect(updates).toContain("recording");
});

it("stops the worker interval on dispose and ignores devices afterwards", async () => {
  const { worker, session, pedal } = await ride();

  pedal(1);
  expect(worker.activeTimers()).toBe(1);
  session.dispose();
  worker.flush();
  expect(worker.activeTimers()).toBe(0);

  const last = session.snapshot()?.tS;

  pedal(1);
  expect(session.snapshot()?.tS).toBe(last);
});
