import { createManualTicker } from "@voltonaut/ble";
import {
  createEngine,
  createRoute,
  FLAT_LOOP,
  TEST_LOOP,
  type RideSnapshot,
} from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import { expect, it } from "vitest";

import type { AppDocument, RideHudSource } from "./app.js";
import { startApp } from "./app.js";
import type { TextTarget } from "./ui/hud.js";
import { createSegmentProjector } from "./game/segments.js";

interface Target extends TextTarget {
  readonly read: () => string;
}

function createTarget(): Target {
  let text = "";

  return {
    write: (value: string): void => {
      text = value;
    },
    read: () => text,
  };
}

function createTargets() {
  return {
    "hud-powerW": createTarget(),
    "hud-cadenceRpm": createTarget(),
    "hud-heartRateBpm": createTarget(),
    "hud-gear": createTarget(),
    "hud-status": createTarget(),
    "hud-speed": createTarget(),
    "hud-distance": createTarget(),
    "hud-elevationGain": createTarget(),
    "hud-energy": createTarget(),
    "hud-warning": createTarget(),
    "hud-sprint": createTarget(),
    "hud-kom": createTarget(),
  };
}

function createDocument(
  missingSelector?: string,
): AppDocument & { targets: Record<string, Target> } {
  const targets = createTargets();
  const targetsById = new Map<string, TextTarget>(Object.entries(targets));

  return {
    targets,
    querySelector(selector: string) {
      if (selector === missingSelector) {
        return null;
      }

      return targetsById.get(selector.slice(1)) ?? null;
    },
  };
}

function createRideSource() {
  const engine = createEngine({ route: createRoute(FLAT_LOOP), profile: DEFAULT_RIDER_PROFILE });
  const segments = createSegmentProjector(FLAT_LOOP);

  engine.ingest({ type: "trainer.data", tS: 0, powerW: 210, cadenceRpm: 95 });
  engine.advance(1);

  return {
    bus: engine,
    source: {
      snapshot: (): RideSnapshot | undefined => engine.snapshot(),
      connected: () => true,
      segments: () => segments.view(),
      dispose: () => {
        engine.drainEvents();
        segments.unavailable();
      },
    },
  };
}

it("renders the engine snapshot values into the HUD", () => {
  const document = createDocument();
  const ticker = createManualTicker();

  startApp({ document, ride: createRideSource().source, ticker });

  expect(document.targets["hud-powerW"]?.read()).toMatch(/^\d+ W$/u);
  expect(document.targets["hud-distance"]?.read()).toMatch(/^\d+\.\d\d km$/u);
  expect(document.targets["hud-status"]?.read()).toBe("Sim connected");
  expect(document.targets["hud-warning"]?.read()).toBe("");
});

it("re-renders on every tick and freezes after stop", () => {
  const document = createDocument();
  const ticker = createManualTicker();
  const ride = createRideSource();
  const app = startApp({ document, ride: ride.source, ticker });

  const before = document.targets["hud-distance"]?.read();
  ride.bus.advance(60);
  ticker.tick();

  expect(document.targets["hud-distance"]?.read()).not.toBe(before);

  app.stop();
  const stopped = document.targets["hud-distance"]?.read();
  ride.bus.advance(60);
  ticker.tick();

  expect(document.targets["hud-distance"]?.read()).toBe(stopped);
});

it("skips rendering while no snapshot exists yet", () => {
  const document = createDocument();
  const ticker = createManualTicker();
  let disposed = false;

  const ride: RideHudSource = {
    snapshot: () => {},
    connected: () => false,
    segments: () => createSegmentProjector(FLAT_LOOP).view(),
    dispose: () => {
      disposed = true;
    },
  };

  const app = startApp({ document, ride, ticker });

  expect(document.targets["hud-powerW"]?.read()).toBe("");

  app.stop();
  expect(disposed).toBe(true);
});

it("rejects a document with missing HUD elements", () => {
  const document = createDocument("#hud-status");
  const ride = createRideSource();

  expect(() => startApp({ document, ride: ride.source, ticker: createManualTicker() })).toThrow(
    "HUD elements are missing from the document",
  );
});

it("renders unavailable segments without inventing a missing engine snapshot", () => {
  const document = createDocument();
  const segments = createSegmentProjector(TEST_LOOP);
  segments.unavailable();

  const ride: RideHudSource = {
    snapshot: () => {},
    connected: () => false,
    segments: () => segments.view(),
    dispose: () => {},
  };

  startApp({ document, ride, ticker: createManualTicker() });
  expect(document.targets["hud-sprint"]?.read()).toBe("Sprint · ungültig · Engine nicht verfügbar");
  expect(document.targets["hud-powerW"]?.read()).toBe("");
});

it("pulls segment progress on the existing ticker and exposes invalidation on stop", () => {
  const document = createDocument();
  const ticker = createManualTicker();
  const segments = createSegmentProjector(TEST_LOOP);

  const snapshot = createEngine({
    route: createRoute(TEST_LOOP),
    profile: DEFAULT_RIDER_PROFILE,
  }).snapshot();

  segments.consume({
    events: [{ type: "segment.entered", segmentId: "sprint-1", tS: 1 }],
    snapshot: { ...snapshot, tS: 3, routePosM: 2200 },
  });

  const ride: RideHudSource = {
    snapshot: () => snapshot,
    connected: () => true,
    segments: () => segments.view(),
    dispose: () => {
      segments.unavailable();
    },
  };

  const app = startApp({ document, ride, ticker });
  expect(document.targets["hud-sprint"]?.read()).toContain("2.0 s · noch 300 m");
  segments.consume({ events: [], snapshot: { ...snapshot, tS: 4, routePosM: 2300 } });
  ticker.tick();
  expect(document.targets["hud-sprint"]?.read()).toContain("3.0 s · noch 200 m");
  app.stop();
  expect(document.targets["hud-sprint"]?.read()).toContain("ungültig · Engine nicht verfügbar");
});

it("requires segment targets along with the existing HUD", () => {
  const document = createDocument("#hud-sprint");
  expect(() =>
    startApp({
      document,
      ride: createRideSource().source,
      ticker: createManualTicker(),
    }),
  ).toThrow("HUD elements are missing");
});
