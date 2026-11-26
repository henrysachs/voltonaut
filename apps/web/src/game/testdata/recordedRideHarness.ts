import {
  DEFAULT_RIDER_PROFILE,
  type DeviceEvent,
  type RideMode,
  type WorldPathReference,
} from "@voltonaut/shared";

import {
  startRecordedRide,
  type RecordedRide,
  type RideInit,
  type RideUpdate,
} from "../recordedRide.js";
import type { CaptureCommand, CaptureResult } from "../rideCaptureProtocol.js";
import { createManualClock } from "./workerClock.js";

/** The path of a single-route world from step 1 of ADR-033: world, path and route share the id. */
export function singleRouteWorldPath(routeId: string): WorldPathReference {
  return { worldId: routeId, worldRevision: "1", pathId: routeId };
}

/** The world path the app rides (main.ts). */
export const TEST_LOOP_PATH = singleRouteWorldPath("test-loop");

export const FIRST_RIDE_ID = "550e8400-e29b-41d4-a716-446655440000";
export const SECOND_RIDE_ID = "550e8400-e29b-41d4-a716-446655440001";

export const TRAINER_READING = {
  type: "trainer.data",
  tS: 0,
  powerW: 200,
  cadenceRpm: 90,
} satisfies DeviceEvent;

export interface RideHarnessOptions {
  readonly init?: Partial<RideInit>;
  readonly startMs?: number;
  readonly timeOriginMs?: number;
  readonly newId?: () => string;
}

function startHarnessRide(options: RideHarnessOptions, atMs: number) {
  return startRecordedRide(
    {
      source: "sim",
      worldPath: TEST_LOOP_PATH,
      profile: DEFAULT_RIDER_PROFILE,
      clockScale: 1,
      ...options.init,
    },
    atMs,
    options.timeOriginMs ?? 0,
    options.newId ?? (() => FIRST_RIDE_ID),
  );
}

/** Recording commands with increasing request ids, read at the current manual clock. */
function captureCommands(ride: RecordedRide, nowMs: () => number) {
  let requestId = 0;

  return {
    /** Sends the command with the next fresh request id. */
    capture: (kind: CaptureCommand["kind"], rideId = FIRST_RIDE_ID): CaptureResult => {
      requestId += 1;

      return ride.capture(requestId, { kind, rideId }, nowMs());
    },
    /** Sends the command with an explicit request id, e.g. to replay a duplicate. */
    captureAs: (id: number, command: CaptureCommand): CaptureResult => {
      if (Number.isSafeInteger(id)) requestId = Math.max(requestId, id);

      return ride.capture(id, command, nowMs());
    },
  };
}

/** Drives one recorded ride directly with a manual worker clock. */
export function createRideHarness(options: RideHarnessOptions = {}) {
  const clock = createManualClock(options.startMs ?? 0);
  const { nowMs } = clock;
  const started = startHarnessRide(options, nowMs());
  const { ride } = started;
  const updates: RideUpdate[] = [started.update];

  return {
    ride,
    updates,
    nowMs,
    ...captureCommands(ride, nowMs),
    latest: (): RideUpdate => updates.at(-1) ?? started.update,
    elapse: clock.advanceMs,
    advanceTo: (toMs: number) => {
      clock.advanceMs(toMs - nowMs());
    },
    /** The first wake of a ride only arms its clock and yields no update. */
    arm: () => {
      if (ride.wake(nowMs()) !== undefined) throw new Error("Expected an arming wake");
    },
    wake: (elapsedMs = 0): RideUpdate => {
      clock.advanceMs(elapsedMs);
      const update = ride.wake(nowMs());

      if (update === undefined) throw new Error("Expected an advancing wake");
      updates.push(update);

      return update;
    },
    ingest: (event: DeviceEvent) => {
      ride.ingest(event, nowMs());
    },
    setMode: (mode: RideMode) => {
      ride.setMode(mode, nowMs());
    },
  };
}

export function finishedCapture(result: CaptureResult) {
  if (result.kind !== "finished") throw new Error("Expected finished capture");

  return result.capture;
}

export function journalCapture(result: CaptureResult) {
  const capture = finishedCapture(result);

  if (capture.kind !== "journal") throw new Error("Expected complete journal");

  return capture;
}

export function localCapture(result: CaptureResult) {
  const capture = finishedCapture(result);

  if (capture.kind !== "local_only") throw new Error("Expected local-only capture");

  return capture;
}
