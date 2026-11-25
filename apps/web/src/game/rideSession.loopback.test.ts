import {
  createKeyboardAdapter,
  createManualTicker,
  createRideDeviceSet,
  createSimDeviceTransports,
  createSimScript,
  type KeyboardSource,
  type TrainerEngineUpdate,
} from "@voltonaut/ble";
import type { RideSnapshot } from "@voltonaut/engine";
import { createEventBus, DEFAULT_RIDER_PROFILE, type TrainerCommand } from "@voltonaut/shared";
import { expect, it } from "vitest";

import type { CaptureView } from "./rideCaptureProtocol.js";
import { createRideSession } from "./rideSession.js";
import { createLoopbackWorker } from "./testdata/loopbackWorker.js";

const SAMPLES = createSimScript([{ powerW: 250, cadenceRpm: 90, heartRateBpm: 130 }]);

function requireSnapshot(snapshot: RideSnapshot | undefined): RideSnapshot {
  if (snapshot === undefined) throw new Error("Expected a worker snapshot");

  return snapshot;
}

function completedRideId(view: CaptureView): string {
  if (view.kind !== "completed") throw new Error(`Expected a completed capture, got ${view.kind}`);

  return view.rideId;
}

async function settle(rounds = 20): Promise<void> {
  if (rounds === 0) return;
  await Promise.resolve();
  await settle(rounds - 1);
}

/** Moves sim time for the devices and worker time for the engine together. */
function driver(
  worker: Readonly<Pick<ReturnType<typeof createLoopbackWorker>, "advanceMs">>,
  ticker: Readonly<Pick<ReturnType<typeof createManualTicker>, "tick">>,
  advanceSimS: (deltaS: number) => void,
) {
  return {
    /** Rides for `seconds`: one trainer reading per 250 ms, the worker waking every 50 ms. */
    pedal: (seconds: number): void => {
      for (let step = 0; step < seconds * 4; step += 1) {
        advanceSimS(0.25);
        ticker.tick();
        worker.advanceMs(250);
      }
    },
    /** Worker time passes with the trainer silent: no samples, so the engine coasts to a stop. */
    coast: (seconds: number): void => {
      for (let second = 0; second < seconds; second += 1) {
        advanceSimS(1);
        worker.advanceMs(1000);
      }
    },
    /** One trainer sample, delivered before the worker sees it. */
    stroke: (): void => {
      advanceSimS(0.25);
      ticker.tick();
    },
  };
}

/** Simulation grades in 0.01 %, as the FTMS codec encodes them. */
function gradeHundredths(commands: readonly (TrainerCommand | undefined)[]): readonly number[] {
  return commands.flatMap((command) =>
    command?.type === "simulation" ? [Math.round(command.gradePct * 100)] : [],
  );
}

/** Sim shifting path: the keyboard adapter fed by a scripted key source. */
function scriptedKeys() {
  let listener: Parameters<KeyboardSource["subscribe"]>[0] | undefined;

  const source: KeyboardSource = {
    subscribe(next) {
      listener = next;

      return () => {
        listener = undefined;
      };
    },
  };

  return {
    source,
    pressShiftUp(): void {
      listener?.("keydown", { key: "ArrowUp" });
      listener?.("keyup", { key: "ArrowUp" });
    },
  };
}

/** Real adapters over sim peripherals on a manual ticker, and the real worker driver behind the loopback port. */
async function ride() {
  const worker = createLoopbackWorker(1000, Date.parse("2026-11-25T08:00:00.000Z"));
  const bus = createEventBus();
  const ticker = createManualTicker();
  let simS = 0;
  const clock = { nowS: () => simS };

  const { trainer } = createRideDeviceSet({
    bus,
    clock,
    ticker,
    clockScale: 1,
    transports: createSimDeviceTransports({ ticker, samples: SAMPLES }),
  });

  const keys = scriptedKeys();
  const keyboard = createKeyboardAdapter({ bus, clock, source: keys.source });
  const commands: TrainerCommand[] = [];
  const updates: TrainerEngineUpdate[] = [];

  const session = createRideSession(
    {
      bus,
      routeId: "test-loop",
      profile: DEFAULT_RIDER_PROFILE,
      source: "sim",
      clockScale: 1,
      trainer: {
        forward: (update) => {
          updates.push(update);
          commands.push(...update.commands);
          trainer.control.forward(update);
        },
      },
    },
    () => worker.port,
  );

  await Promise.all([trainer.connect(), keyboard.connect()]);

  const drive = driver(worker, ticker, (deltaS) => {
    simS += deltaS;
  });

  return { worker, session, keys, trainer, commands, updates, ...drive };
}

it("turns sim device events into snapshots, segments and trainer commands without a browser", async () => {
  const { worker, session, keys, commands, pedal } = await ride();

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

  keys.pressShiftUp();
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

it("sends no trainer target from an auto-paused ride before the worker resumes it", async () => {
  const { worker, session, trainer, updates, pedal, coast, stroke } = await ride();

  pedal(10);
  expect(updates.some((update) => update.commands.length > 0)).toBe(true);
  coast(110);
  expect(session.snapshot()?.paused).toBe(true);

  await trainer.control.enable();
  expect(trainer.control.view()).toMatchObject({
    authority: { kind: "active" },
    target: undefined,
    hardware: "neutralAcknowledged",
  });

  // The first stroke reaches the trainer before the worker has seen it.
  stroke();
  expect(trainer.control.view().target).toBeUndefined();

  const resumedAt = updates.length;

  worker.advanceMs(50);

  const resumed = updates.slice(resumedAt).filter((update) => !update.paused);
  const resumeGrades = gradeHundredths(resumed.flatMap((update) => update.commands));

  expect(resumeGrades).toHaveLength(1);
  await settle();

  const { target, acknowledged, hardware } = trainer.control.view();

  // The trainer holds the resume command as encoded (0.01 % grade) and the Sim control point ACKs it.
  expect(gradeHundredths([target])).toEqual(resumeGrades);
  expect(acknowledged).toEqual(target);
  expect(hardware).toBe("targetAcknowledged");
});
