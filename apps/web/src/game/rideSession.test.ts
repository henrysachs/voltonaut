import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import {
  DEFAULT_RIDER_PROFILE,
  type RideEvent,
  type RideProgressCheckpoint,
} from "@voltonaut/shared";
import { expect, it } from "vitest";

import type { EngineWorkerResponse } from "./engineWorkerCore.js";
import { createRideSession } from "./rideSession.js";
import { createFakePort } from "./testdata/enginePort.js";

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

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

function requireActorId(value: string | undefined): string {
  if (value === undefined) throw new Error("Missing actor ID");

  return value;
}

function setup() {
  const fake = createFakePort();
  const calls: string[] = [];

  const session = createRideSession(
    "test-loop",
    {
      onSnapshot: () => {
        calls.push("snapshot");
      },
      onCommands: () => {
        calls.push("commands");
      },
    },
    () => fake.port,
  );

  session.link.init({ source: "sim", routeId: "test-loop", profile: DEFAULT_RIDER_PROFILE });
  const request = fake.sent[0];

  if (request?.type !== "engine.init") throw new Error("Missing initialization");

  const deliver = (tS: number, events: readonly RideEvent[]): void => {
    fake.deliver({
      type: "engine.update",
      actorId: request.actorId,
      snapshot: { ...snapshot, tS, routePosM: 2200, distanceM: 2200 },
      events,
      commands: [],
      recording: { kind: "idle", availability: { kind: "journal" } },
    });
  };

  return { ...fake, ...session, calls, deliver };
}

it("creates the projector before initialization, preserves device callbacks and consumes empty batches", () => {
  const session = setup();
  session.deliver(4, [entry]);
  expect(session.calls).toEqual(["snapshot", "commands"]);
  expect(session.segments.view().rows[0]?.progress).toEqual({
    kind: "active",
    lap: 0,
    elapsedS: 2,
    remainingM: 300,
  });
  session.deliver(5, []);
  expect(session.segments.view().rows[0]?.progress).toMatchObject({ elapsedS: 3 });
});

it("forwards undefined and real progress checkpoints to session callbacks", () => {
  const fake = createFakePort();
  const seen: (RideProgressCheckpoint | undefined)[] = [];

  const session = createRideSession(
    "test-loop",
    {
      onProgress: (checkpoint) => {
        seen.push(checkpoint);
      },
    },
    () => fake.port,
  );

  const update = {
    type: "engine.update",
    actorId: "actor",
    snapshot,
    events: [],
    commands: [],
    recording: { kind: "idle", availability: { kind: "journal" } },
  } satisfies EngineWorkerResponse;

  session.link.init({ source: "sim", routeId: "test-loop", profile: DEFAULT_RIDER_PROFILE });
  const actorId = requireActorId(fake.sent[0]?.actorId);

  fake.deliver({ ...update, actorId });
  fake.deliver({ ...update, actorId, progress: undefined });
  fake.deliver({ ...update, actorId, progress });

  expect(seen).toEqual([undefined, undefined, progress]);
});

it("invalidates an active preview on worker failure and ignores late replies", () => {
  const session = setup();
  session.deliver(4, [entry]);
  session.fail("Worker failed");
  session.deliver(5, [{ type: "segment.exited", segmentId: entry.segmentId, tS: 5 }]);
  expect(session.segments.view().rows[0]?.progress).toEqual({
    kind: "invalid",
    reason: "engine_unavailable",
  });
});

it("reports initialization failure without a fabricated snapshot", () => {
  const session = setup();
  session.fail("Initialization failed");
  expect(session.link.latestSnapshot()).toBeUndefined();
  expect(session.segments.view().rows[0]?.progress).toEqual({
    kind: "invalid",
    reason: "engine_unavailable",
  });
});

it("rejects unknown routes before creating a worker port", () => {
  const ports: string[] = [];
  expect(() =>
    createRideSession("missing", {}, () => {
      ports.push("created");

      return createFakePort().port;
    }),
  ).toThrow("Unknown route");
  expect(ports).toEqual([]);
});
