import { expect, it } from "vitest";
import { createEngine, createRoute, FLAT_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE, type CapturedRide } from "@voltonaut/shared";

import type { EngineWorkerRequest, EngineWorkerResponse } from "./engineWorkerCore.js";
import type { EngineWorkerPort } from "./engine-link.js";
import { createEngineLink } from "./engine-link.js";
import { localRide } from "../sync/testdata/localRide.js";
import type { CaptureView } from "./rideCaptureProtocol.js";

function createFakePort() {
  const listeners = new Set<(message: EngineWorkerResponse) => void>();
  const errors = new Set<(message: string) => void>();
  const sent: EngineWorkerRequest[] = [];

  const port: EngineWorkerPort = {
    postMessage: (message) => {
      sent.push(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    subscribeFailure: (listener) => {
      errors.add(listener);

      return () => {
        errors.delete(listener);
      };
    },
  };

  return {
    port,
    sent,
    deliver: (message: EngineWorkerResponse) => {
      for (const listener of listeners) listener(message);
    },
    fail: (message: string) => {
      for (const listener of errors) listener(message);
    },
  };
}

const profile = DEFAULT_RIDER_PROFILE;
const snapshot = createEngine({ route: createRoute(FLAT_LOOP), profile }).snapshot();
const idle = { kind: "idle", availability: { kind: "journal" } } satisfies CaptureView;

const recording = {
  kind: "recording",
  rideId: "id-2",
  elapsedMs: 0,
  availability: { kind: "journal" },
} satisfies CaptureView;

const completed = {
  kind: "completed",
  rideId: "id-2",
  availability: { kind: "journal" },
} satisfies CaptureView;

const capture: CapturedRide = {
  kind: "local_only",
  reason: "journal_age",
  track: {
    rideId: localRide.rideId,
    startedAt: localRide.startedAt,
    metadata: localRide.metadata,
    samples: localRide.samples,
  },
};

function setup() {
  const fake = createFakePort();
  let ids = 0;

  const link = createEngineLink(fake.port, {}, () => {
    ids += 1;

    return `id-${ids}`;
  });

  link.init({ routeId: "test-loop", profile, source: "sim" });
  fake.deliver({
    type: "engine.update",
    actorId: "id-1",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });

  return { ...fake, link };
}

it("sends frozen initialization and ignores stale actor snapshots", () => {
  const { link, sent, deliver } = setup();
  expect(sent[0]).toEqual({
    type: "engine.init",
    actorId: "id-1",
    source: "sim",
    routeId: "test-loop",
    profile,
    clockScale: 1,
  });
  link.ingest({ type: "trainer.data", tS: 1, powerW: 200 });
  expect(sent[1]).toMatchObject({ type: "engine.ingest", actorId: "id-1" });
  deliver({
    type: "engine.update",
    actorId: "old",
    snapshot: { ...snapshot, tS: 999 },
    events: [],
    commands: [],
    recording: idle,
  });
  expect(link.latestSnapshot()?.tS).toBe(0);
  expect(() => {
    link.init({ routeId: "test-loop", profile, source: "sim" });
  }).toThrow("already initialized");
});

it("delivers snapshot before commands on every update, including empty command arrays", async () => {
  const fake = createFakePort();
  const calls: string[] = [];

  const link = createEngineLink(
    fake.port,
    {
      onSnapshot: () => {
        calls.push("snapshot");
      },
      onEvents: () => {
        calls.push("events");
      },
      onCommands: (commands) => {
        calls.push(`commands:${commands.length}`);
      },
    },
    () => "actor",
  );

  link.init({ source: "sim", routeId: "test-loop", profile });
  fake.deliver({
    type: "engine.update",
    actorId: "actor",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  fake.deliver({
    type: "engine.update",
    actorId: "actor",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  const start = link.recording.start();
  fake.deliver({
    type: "recording.reply",
    actorId: "actor",
    requestId: 1,
    result: { kind: "state", view: recording },
  });
  await start;
  expect(calls).toEqual(["snapshot", "events", "commands:0", "snapshot", "events", "commands:0"]);
});

it("correlates recording acknowledgements and ignores duplicate and late replies", async () => {
  const { link, sent, deliver } = setup();
  const start = link.recording.start();
  expect(sent[1]).toEqual({
    type: "recording.command",
    actorId: "id-1",
    requestId: 1,
    command: { kind: "start", rideId: "id-2" },
  });

  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 1,
    result: { kind: "state", view: recording },
  });
  await start;
  const finish = link.recording.finish();

  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 2,
    result: { kind: "finished", capture, view: completed },
  });
  expect(await finish).toBe(capture);
  const release = link.recording.release("id-2");
  deliver({
    type: "recording.reply",
    actorId: "old",
    requestId: 3,
    result: { kind: "state", view: recording },
  });
  expect(link.recording.state()).toEqual(completed);
  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 3,
    result: { kind: "state", view: idle },
  });
  await release;
  deliver({
    type: "recording.reply",
    actorId: "id-1",
    requestId: 2,
    result: { kind: "finished", capture, view: completed },
  });
  expect(link.recording.state()).toEqual(idle);
});

it("rejects pending requests on worker error and ignores later successes", async () => {
  const { link, fail, deliver } = setup();
  const start = link.recording.start();
  const rejected = start.catch((cause: unknown) => cause);
  fail("broken");
  expect(await rejected).toEqual(new Error("broken"));
  deliver({
    type: "engine.update",
    actorId: "id-1",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  expect(link.recording.state()).toEqual({ kind: "unavailable", message: "broken" });
  await expect(link.recording.start()).rejects.toThrow("nicht verfügbar");
});

it("settles pending requests on init failure and disposal", async () => {
  const { link, deliver, sent } = setup();
  const start = link.recording.start();
  const rejected = start.catch((cause: unknown) => cause);
  link.dispose();
  expect(await rejected).toEqual(new Error("Engine geschlossen."));
  expect(sent.at(-1)).toEqual({ type: "engine.dispose", actorId: "id-1" });
  deliver({
    type: "engine.update",
    actorId: "id-1",
    snapshot,
    events: [],
    commands: [],
    recording: idle,
  });
  expect(link.recording.state().kind).toBe("unavailable");
  const next = setup();
  const pending = next.link.recording.start();
  const failed = pending.catch((cause: unknown) => cause);
  next.deliver({ type: "engine.initFailed", actorId: "id-1", message: "bad initialization" });
  expect(await failed).toEqual(new Error("bad initialization"));
});
