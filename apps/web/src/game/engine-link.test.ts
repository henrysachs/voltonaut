import { expect, it } from "vitest";

import { createEngine, createRoute, FLAT_LOOP } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE, type RideEvent, type TrainerCommand } from "@voltonaut/shared";

import type { EngineWorkerRequest, EngineWorkerResponse } from "./engineWorkerCore.js";
import type { EngineWorkerPort } from "./engine-link.js";
import type { EngineLinkCallbacks } from "./engine-link.js";
import { createEngineLink } from "./engine-link.js";

function createFakePort(): EngineWorkerPort & {
  sent: EngineWorkerRequest[];
  deliver: (message: EngineWorkerResponse) => void;
} {
  const listeners: ((message: EngineWorkerResponse) => void)[] = [];
  const sent: EngineWorkerRequest[] = [];

  return {
    sent,
    postMessage(message: EngineWorkerRequest): void {
      sent.push(message);
    },
    subscribe(listener: (message: EngineWorkerResponse) => void): () => void {
      listeners.push(listener);

      return () => {
        const index = listeners.indexOf(listener);
        void listeners.splice(index, 1);
      };
    },
    deliver(message: EngineWorkerResponse): void {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

it("sends init with the frozen profile and a default clock scale", () => {
  const port = createFakePort();
  const link = createEngineLink(port);

  link.init({ routeId: "test-loop", profile: DEFAULT_RIDER_PROFILE });

  expect(port.sent).toEqual([
    { type: "engine.init", routeId: "test-loop", profile: DEFAULT_RIDER_PROFILE, clockScale: 1 },
  ]);
});

it("forwards device events and exposes the latest snapshot", () => {
  const port = createFakePort();
  let snapshotCalls = 0;
  let eventCount = 0;
  let commandCount = 0;

  const callbacks: EngineLinkCallbacks = {
    onSnapshot: () => {
      snapshotCalls += 1;
    },
    onEvents: (events: readonly RideEvent[]) => {
      eventCount += events.length;
    },
    onCommands: (commands: readonly TrainerCommand[]) => {
      commandCount += commands.length;
    },
  };

  const link = createEngineLink(port, callbacks);

  link.ingest({ type: "trainer.data", tS: 1, powerW: 200, cadenceRpm: 90 });

  expect(port.sent).toEqual([
    {
      type: "engine.ingest",
      event: { type: "trainer.data", tS: 1, powerW: 200, cadenceRpm: 90 },
    },
  ]);

  const snapshot = createEngine({
    route: createRoute(FLAT_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
  }).snapshot();

  port.deliver({ type: "engine.update", snapshot, events: [], commands: [] });

  expect(link.latestSnapshot()).toBe(snapshot);
  expect(snapshotCalls).toBe(1);
  expect(eventCount).toBe(0);
  expect(commandCount).toBe(0);
});

it("reports init failures", () => {
  const port = createFakePort();
  const failures: string[] = [];

  const link = createEngineLink(port, {
    onInitFailed: (message) => {
      failures.push(message);
    },
  });

  port.deliver({ type: "engine.initFailed", message: "unknown route x" });

  expect(failures).toEqual(["unknown route x"]);
  expect(link.latestSnapshot()).toBeUndefined();
});

it("unsubscribes on dispose and sends the dispose request", () => {
  const port = createFakePort();
  const link = createEngineLink(port);

  link.dispose();

  expect(port.sent).toEqual([{ type: "engine.dispose" }]);

  const snapshot = createEngine({
    route: createRoute(FLAT_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
  }).snapshot();

  port.deliver({ type: "engine.update", snapshot, events: [], commands: [] });

  expect(link.latestSnapshot()).toBeUndefined();
});
