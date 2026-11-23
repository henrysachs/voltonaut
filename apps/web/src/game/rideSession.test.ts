import { createEngine, createRoute, TEST_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE, type RideEvent } from "@voltonaut/shared";
import { expect, it } from "vitest";

import { createRideSession } from "./rideSession.js";
import { createFakePort } from "./testdata/enginePort.js";

const snapshot = createEngine({
  route: createRoute(TEST_LOOP),
  profile: DEFAULT_RIDER_PROFILE,
}).snapshot();

const entry: RideEvent = { type: "segment.entered", segmentId: "sprint-1", tS: 2 };

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
