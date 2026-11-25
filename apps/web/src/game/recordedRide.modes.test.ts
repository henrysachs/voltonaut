import { expect, it } from "vitest";

import { createRideHarness } from "./testdata/recordedRideHarness.js";

function startedRide() {
  const run = createRideHarness();
  run.arm();

  return {
    ...run,
    rideFor: (seconds: number) => {
      for (let elapsedMs = 0; elapsedMs < seconds * 1000; elapsedMs += 50) {
        run.ingest({ type: "trainer.data", tS: elapsedMs / 1000, powerW: 250, cadenceRpm: 90 });
        run.wake(50);
      }
    },
  };
}

it("setMode reaches the engine and fun mode posts no progress checkpoints", () => {
  const run = startedRide();

  expect(run.wake(50).progress).toBeDefined();
  run.setMode("fun");

  const update = run.wake(50);

  expect(update.snapshot.mode.kind).toBe("fun");
  expect(update.progress).toBeUndefined();
});

it("switching back to normal resumes progress", () => {
  const run = startedRide();

  run.setMode("fun");
  run.wake(50);
  run.setMode("normal");

  const update = run.wake(50);

  expect(update.snapshot.mode.kind).toBe("normal");
  expect(update.progress).toBeDefined();
});

it("refuses to start a recording in fun mode", () => {
  const run = startedRide();

  run.setMode("fun");
  run.wake(50);
  expect(run.capture("start")).toMatchObject({
    kind: "failed",
    message: "In diesem Spielmodus gibt es keine Aufnahme.",
  });
});

it("refuses a start right after the fun request, before any tick ran in fun mode", () => {
  const run = startedRide();

  run.setMode("fun");
  expect(run.capture("start").kind).toBe("failed");
});

it("ignores a switch to fun mode while a recording is running", () => {
  const run = startedRide();

  expect(run.capture("start").kind).not.toBe("failed");
  run.setMode("fun");

  const update = run.wake(50);

  expect(update.snapshot.mode.kind).toBe("normal");
  expect(update.progress).toBeDefined();
});

it("marks later recordings of the session local-only with reason ride_mode", () => {
  const run = startedRide();

  run.setMode("fun");
  run.wake(50);
  run.setMode("normal");
  run.wake(50);
  run.capture("start");
  run.rideFor(1.5);
  expect(run.capture("finish")).toMatchObject({
    kind: "finished",
    capture: { kind: "local_only", reason: "ride_mode" },
  });
});

it("keeps verifiable journal recordings when fun mode was never used", () => {
  const run = startedRide();

  run.wake(50);
  run.capture("start");
  run.rideFor(1.5);
  expect(run.capture("finish")).toMatchObject({
    kind: "finished",
    capture: { kind: "journal" },
  });
});
