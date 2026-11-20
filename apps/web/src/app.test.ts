import { createManualTicker } from "@voltonaut/ble";
import { createEngine, createRoute, FLAT_LOOP, type RideSnapshot } from "@voltonaut/engine";
import { DEFAULT_RIDER_PROFILE } from "@voltonaut/shared";
import { expect, it } from "vitest";

import type { AppDocument, RideHudSource } from "./app.js";
import { startApp } from "./app.js";
import type { TextTarget } from "./ui/hud.js";

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
  };
}

function createDocument(
  withMissingElement = false,
): AppDocument & { targets: Record<string, Target> } {
  const targets = createTargets();
  const targetsById = new Map<string, TextTarget>(Object.entries(targets));

  return {
    targets,
    querySelector(selector: string) {
      if (withMissingElement && selector === "#hud-status") {
        return null;
      }

      return targetsById.get(selector.slice(1)) ?? null;
    },
  };
}

function createRideSource() {
  const engine = createEngine({ route: createRoute(FLAT_LOOP), profile: DEFAULT_RIDER_PROFILE });

  engine.ingest({ type: "trainer.data", tS: 0, powerW: 210, cadenceRpm: 95 });
  engine.advance(1);

  return {
    bus: engine,
    source: {
      snapshot: (): RideSnapshot | undefined => engine.snapshot(),
      connected: () => true,
      dispose: () => {
        engine.drainEvents();
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
  const document = createDocument(true);
  const ride = createRideSource();

  expect(() => startApp({ document, ride: ride.source, ticker: createManualTicker() })).toThrow(
    "HUD elements are missing from the document",
  );
});
