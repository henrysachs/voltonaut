import {
  array,
  assert,
  boolean,
  constant,
  constantFrom,
  double,
  integer,
  oneof,
  option,
  property,
  record,
  type Arbitrary,
} from "fast-check";
import { expect, it } from "vitest";
import {
  DEFAULT_RIDER_PROFILE,
  RecordingEntryV2Schema,
  type DeviceEvent,
  type RecordingEntryV2,
  type RideEvent,
  type TrainerCommand,
} from "@voltonaut/shared";

import { TEST_LOOP } from "../elevation/data/test-loop.js";
import { createRoute } from "../elevation/route.js";
import { createEngine, type Engine, type RideSnapshot } from "../internal/engine.js";
import { applyJournalEntry } from "./apply.js";
import { encodeJournalInput } from "./encode.js";
import { projectReplaySnapshot, replaySnapshotEqual } from "./replaySnapshot.js";

type Step =
  | { readonly kind: "event"; readonly event: DeviceEvent }
  | { readonly kind: "advance"; readonly elapsedRealS: number };

interface Observed {
  readonly snapshot: RideSnapshot;
  readonly events: readonly RideEvent[];
  readonly commands: readonly TrainerCommand[];
}

const reading = (max: number) =>
  option(double({ min: 0, max, noNaN: true }), { nil: undefined, freq: 3 });

interface TrainerReadings {
  powerW?: number;
  cadenceRpm?: number;
  speedMps?: number;
}

function trainerEvent(readings: {
  readonly powerW: number | undefined;
  readonly cadenceRpm: number | undefined;
  readonly speedMps: number | undefined;
}): DeviceEvent {
  const present: TrainerReadings = {};

  if (readings.powerW !== undefined) present.powerW = readings.powerW;

  if (readings.cadenceRpm !== undefined) present.cadenceRpm = readings.cadenceRpm;

  if (readings.speedMps !== undefined) present.speedMps = readings.speedMps;

  return { type: "trainer.data", tS: 0, ...present };
}

const trainerData: Arbitrary<DeviceEvent> = record({
  powerW: reading(2000),
  cadenceRpm: reading(200),
  speedMps: reading(100),
}).map((readings) => trainerEvent(readings));

// In-contract inputs only: out-of-range readings invalidate the journal instead of replaying.
const deviceEvent: Arbitrary<DeviceEvent> = oneof(
  trainerData,
  double({ min: 1, max: 250, noNaN: true }).map((bpm) => ({ type: "hr.data", tS: 0, bpm })),
  record({
    button: constantFrom(
      "shiftUp",
      "shiftDown",
      "powerUp",
      "navUp",
      "navDown",
      "navLeft",
      "navRight",
      "confirm",
      "back",
      "brake",
    ),
    pressed: boolean(),
  }).map(({ button, pressed }) => ({
    type: "controller.button",
    tS: 0,
    button,
    pressed,
    source: "property",
  })),
  constantFrom("trainer", "heartRate", "controller", "keyboard").chain((kind) =>
    constantFrom("disconnected", "ready", "reconnecting").map((status) => ({
      type: "device.status",
      tS: 0,
      kind,
      id: "device",
      status,
    })),
  ),
  constant<DeviceEvent>({ type: "controller.battery", tS: 0, percent: 50 }),
  constant<DeviceEvent>({ type: "trainer.controlResult", tS: 0, opCode: 0x11, result: "success" }),
);

const step: Arbitrary<Step> = oneof(
  { arbitrary: deviceEvent.map((event) => ({ kind: "event", event })), weight: 3 },
  {
    arbitrary: integer({ min: 0, max: 1500 }).map((ms) => ({
      kind: "advance",
      elapsedRealS: ms / 1000,
    })),
    weight: 2,
  },
);

function rideEngine(): Engine {
  return createEngine({ route: createRoute(TEST_LOOP), profile: DEFAULT_RIDER_PROFILE });
}

function observe(engine: Engine): Observed {
  return {
    snapshot: engine.snapshot(),
    events: engine.drainEvents(),
    commands: engine.drainCommands(),
  };
}

interface Run {
  readonly live: readonly Observed[];
  readonly replayed: readonly Observed[];
  readonly entries: readonly RecordingEntryV2[];
  readonly rejected: readonly string[];
}

/** Feeds the steps live like the worker, journals them, and replays the journal like the server. */
function liveAndReplayed(steps: readonly Step[], clockScale: number): Run {
  const live = rideEngine();
  const entries: RecordingEntryV2[] = [];
  const rejected: string[] = [];
  const liveObserved: Observed[] = [];
  let atMs = 0;

  for (const current of steps) {
    if (current.kind === "event") {
      const decision = encodeJournalInput(current.event, atMs);
      live.ingest(current.event);

      if (decision.kind !== "ignored") rejected.push(...decision.rejected);

      if (decision.kind === "entry") entries.push(decision.entry);
    } else {
      atMs += current.elapsedRealS * 1000;
      live.advance(current.elapsedRealS * clockScale);
      entries.push([0, atMs, "advance", current.elapsedRealS]);
      liveObserved.push(observe(live));
    }
  }

  const replay = rideEngine();
  const replayed: Observed[] = [];

  for (const entry of entries) {
    applyJournalEntry(replay, entry, clockScale);

    if (entry[2] === "advance") replayed.push(observe(replay));
  }

  return { live: liveObserved, replayed, entries, rejected };
}

/** What the server checks: each replayed snapshot against the worker's projected claim. */
function replayMatchesLiveClaims(run: Run): boolean {
  return (
    run.replayed.length === run.live.length &&
    run.replayed.every((observed, index) => {
      const claim = run.live[index];

      return (
        claim !== undefined &&
        replaySnapshotEqual(observed.snapshot, projectReplaySnapshot(claim.snapshot))
      );
    })
  );
}

it("replays encoded inputs to the same snapshots and outputs as live ingest", () => {
  assert(
    property(
      array(step, { minLength: 1, maxLength: 80 }),
      integer({ min: 1, max: 20 }),
      (steps: readonly Step[], clockScale: number) => {
        const run = liveAndReplayed(steps, clockScale);

        expect(run.rejected).toEqual([]);
        expect(run.entries.every((entry) => RecordingEntryV2Schema.safeParse(entry).success)).toBe(
          true,
        );
        expect(run.replayed).toEqual(run.live);
        expect(replayMatchesLiveClaims(run)).toBe(true);
      },
    ),
    { seed: 20261125, numRuns: 200 },
  );
});
