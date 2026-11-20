import { createManualTicker } from "@voltonaut/ble";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import type { AppDocument } from "./app.js";
import { startApp } from "./app.js";
import { createSimRide } from "./game/simRide.js";
import type { TextTarget } from "./ui/hud.js";

interface FakeHudTargets {
  readonly "hud-powerW": TextTarget & { read: () => string };
  readonly "hud-cadenceRpm": TextTarget & { read: () => string };
  readonly "hud-heartRateBpm": TextTarget & { read: () => string };
  readonly "hud-gear": TextTarget & { read: () => string };
  readonly "hud-status": TextTarget & { read: () => string };
}

function createTextTarget(): TextTarget & { read: () => string } {
  let text = "";

  return {
    write: (value: string): void => {
      text = value;
    },
    read: () => text,
  };
}

function createDocument(withMissingElement = false): AppDocument & {
  targets: FakeHudTargets;
} {
  const targets = {
    "hud-powerW": createTextTarget(),
    "hud-cadenceRpm": createTextTarget(),
    "hud-heartRateBpm": createTextTarget(),
    "hud-gear": createTextTarget(),
    "hud-status": createTextTarget(),
  };

  const targetsById = new Map<string, TextTarget>(Object.entries(targets));

  return {
    targets,
    querySelector(selector) {
      if (withMissingElement && selector === "#hud-status") {
        return null;
      }

      return targetsById.get(selector.slice(1)) ?? null;
    },
  };
}

describe("startApp", () => {
  it("renders the ride state on every tick and stops after stop", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });
    const ticker = createManualTicker();
    const document = createDocument();

    const app = startApp({ document, ride, ticker });
    expect(document.targets["hud-powerW"].read()).toBe("0 W");

    bus.publish({ type: "trainer.data", tS: 1, powerW: 210, cadenceRpm: 95 });
    ticker.tick();
    expect(document.targets["hud-powerW"].read()).toBe("210 W");

    app.stop();
    bus.publish({ type: "trainer.data", tS: 2, powerW: 250, cadenceRpm: 100 });
    ticker.tick();
    expect(document.targets["hud-powerW"].read()).toBe("210 W");
  });

  it("rejects a document with missing HUD elements", () => {
    const bus = createEventBus();
    const ride = createSimRide({ bus });
    const document = createDocument(true);

    expect(() => startApp({ document, ride, ticker: createManualTicker() })).toThrow(
      "HUD elements are missing from the document",
    );
  });
});
