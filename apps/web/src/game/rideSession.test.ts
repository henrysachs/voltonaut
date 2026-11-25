import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import {
  createEventBus,
  DEFAULT_RIDER_PROFILE,
  type DeviceEvent,
  type RideEvent,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";
import { expect, it } from "vitest";

import type { EngineWorkerRequest, EngineWorkerResponse } from "./engineWorkerCore.js";
import { createRideSession, ENGINE_INPUT_TYPES, type RideSessionOptions } from "./rideSession.js";
import { createFakePort } from "./testdata/enginePort.js";

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

type WorkerUpdate = Extract<EngineWorkerResponse, { readonly type: "engine.update" }>;

const entry: RideEvent = { type: "segment.entered", segmentId: "sprint-1", tS: 2 };

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
  routeId: "test-loop",
  routeRevision: "1",
  physics: { massKg: 75, bikeMassKg: 8, cdaM2: 0.32, crr: 0.004, wheelCircM: 2.105 },
  facts: [
    { powerW: 200, cadenceRpm: 90, timeS: 0.05, distanceM: 1, elevationGainM: 0, energyKj: 0.01 },
  ],
  quality: { paused: false, dataAgeS: 0, clockSkipped: false },
} satisfies RideProgressCheckpoint;

function ingestedType(message: EngineWorkerRequest): DeviceEvent["type"] {
  if (message.type !== "engine.ingest") throw new Error(`Unexpected ${message.type}`);

  return message.event.type;
}

function setup(extra: Partial<Pick<RideSessionOptions, "onProgress">> = {}) {
  const fake = createFakePort();
  const bus = createEventBus();
  const calls: string[] = [];

  const session = createRideSession(
    {
      ...extra,
      bus,
      routeId: "test-loop",
      profile: DEFAULT_RIDER_PROFILE,
      source: "sim",
      clockScale: 1,
      trainer: {
        onSnapshot: () => {
          calls.push("snapshot");
        },
        onCommands: () => {
          calls.push("commands");
        },
      },
    },
    () => fake.port,
    () => "actor",
  );

  const deliver = (
    tS: number,
    events: readonly RideEvent[],
    more: Partial<Pick<WorkerUpdate, "snapshot" | "progress">> = {},
  ): void => {
    fake.deliver({
      type: "engine.update",
      actorId: "actor",
      snapshot: { ...snapshot, tS, routePosM: 2200, distanceM: 2200 },
      events,
      commands: [],
      recording: { kind: "idle", availability: { kind: "journal" } },
      ...more,
    });
  };

  return { fake, sent: fake.sent, fail: fake.fail, bus, session, calls, deliver };
}

it("initializes the worker first, then forwards exactly the engine input events from the bus", () => {
  const ride = setup();

  ride.bus.publish({ type: "trainer.data", tS: 1, powerW: 200, cadenceRpm: 90 });
  ride.bus.publish({ type: "hr.data", tS: 1, bpm: 120 });
  ride.bus.publish({
    type: "controller.button",
    tS: 1,
    button: "shiftUp",
    pressed: true,
    source: "sim-play",
  });
  ride.bus.publish({ type: "device.status", tS: 1, kind: "trainer", id: "t", status: "ready" });
  ride.bus.publish({ type: "controller.battery", tS: 1, percent: 80 });
  ride.bus.publish({ type: "trainer.controlResult", tS: 1, opCode: 0x11, result: "success" });

  expect(ride.sent[0]).toEqual({
    type: "engine.init",
    actorId: "actor",
    source: "sim",
    routeId: "test-loop",
    profile: DEFAULT_RIDER_PROFILE,
    clockScale: 1,
  });
  expect(ride.sent.slice(1).map((message) => ingestedType(message))).toEqual([
    ...ENGINE_INPUT_TYPES,
  ]);
});

it("feeds trainer callbacks in order, consumes segment batches and tracks the connection", () => {
  const ride = setup();

  expect(ride.session.connected()).toBe(false);
  ride.bus.publish({ type: "device.status", tS: 0, kind: "trainer", id: "t", status: "ready" });
  expect(ride.session.connected()).toBe(true);
  ride.deliver(4, [entry]);
  expect(ride.calls).toEqual(["snapshot", "commands"]);
  expect(ride.session.segments().rows[0]?.progress).toEqual({
    kind: "active",
    lap: 0,
    elapsedS: 2,
    remainingM: 300,
  });
  ride.deliver(5, []);
  expect(ride.session.segments().rows[0]?.progress).toMatchObject({ elapsedS: 3 });
});

it("reads the actual mode from the snapshot and sends mode intents to the worker", () => {
  const ride = setup();

  expect(ride.session.mode()).toBeUndefined();
  ride.session.requestMode("fun");
  expect(ride.sent.at(-1)).toEqual({ type: "engine.setMode", actorId: "actor", mode: "fun" });
  ride.deliver(1, []);
  expect(ride.session.mode()).toBe("normal");
  ride.deliver(2, [], {
    snapshot: {
      ...snapshot,
      mode: { kind: "fun", heldItem: undefined, activeItem: undefined, activeRemainingS: 0 },
    },
  });
  expect(ride.session.mode()).toBe("fun");
});

it("forwards undefined and real progress checkpoints", () => {
  const seen: (RideProgressCheckpoint | undefined)[] = [];

  const ride = setup({
    onProgress: (checkpoint) => {
      seen.push(checkpoint);
    },
  });

  ride.deliver(1, []);
  ride.deliver(2, [], { progress: undefined });
  ride.deliver(3, [], { progress });
  expect(seen).toEqual([undefined, undefined, progress]);
});

it("invalidates an active preview on worker failure and ignores late updates", () => {
  const ride = setup();

  ride.deliver(4, [entry]);
  ride.fail("Worker failed");
  ride.deliver(5, [{ type: "segment.exited", segmentId: entry.segmentId, tS: 5 }]);
  expect(ride.session.segments().rows[0]?.progress).toEqual({
    kind: "invalid",
    reason: "engine_unavailable",
  });
  expect(ride.session.snapshot()?.tS).toBe(4);
});

it("reports initialization failure without a fabricated snapshot", () => {
  const ride = setup();

  ride.fake.deliver({ type: "engine.initFailed", actorId: "actor", message: "bad" });
  expect(ride.session.snapshot()).toBeUndefined();
  expect(ride.session.recording.state()).toEqual({ kind: "unavailable", message: "bad" });
  expect(ride.session.segments().rows[0]?.progress).toEqual({
    kind: "invalid",
    reason: "engine_unavailable",
  });
});

it("stops forwarding and connection tracking on dispose", () => {
  const ride = setup();

  ride.session.dispose();
  const count = ride.sent.length;

  expect(ride.sent.at(-1)).toEqual({ type: "engine.dispose", actorId: "actor" });
  ride.bus.publish({ type: "device.status", tS: 0, kind: "trainer", id: "t", status: "ready" });
  ride.bus.publish({ type: "trainer.data", tS: 1, powerW: 200 });
  expect(ride.sent).toHaveLength(count);
  expect(ride.session.connected()).toBe(false);
  expect(ride.session.segments().rows[0]?.progress.kind).toBe("invalid");
});

it("rejects unknown routes before creating a worker port or subscribing", () => {
  const ports: string[] = [];
  const bus = createEventBus();

  expect(() =>
    createRideSession(
      { bus, routeId: "missing", profile: DEFAULT_RIDER_PROFILE, source: "sim", clockScale: 1 },
      () => {
        ports.push("created");

        return createFakePort().port;
      },
    ),
  ).toThrow("Unknown route");
  expect(ports).toEqual([]);
});
