import { createManualTicker } from "@voltonaut/ble";
import { createEventBus } from "@voltonaut/shared";
import { describe, expect, it } from "vitest";

import { startApp } from "./app.js";
import type { AppDocument } from "./app.js";
import { createSimRide } from "./game/simRide.js";
import type { TextTarget } from "./ui/hud.js";

interface FakeHudTargets {
  readonly "hud-powerW": TextTarget;
  readonly "hud-cadenceRpm": TextTarget;
  readonly "hud-heartRateBpm": TextTarget;
  readonly "hud-gear": TextTarget;
  readonly "hud-status": TextTarget;
}

function createDocument(withMissingElement = false): AppDocument & {
  targets: FakeHudTargets;
} {
  const targets: FakeHudTargets = {
    "hud-powerW": { textContent: "" },
    "hud-cadenceRpm": { textContent: "" },
    "hud-heartRateBpm": { textContent: "" },
    "hud-gear": { textContent: "" },
    "hud-status": { textContent: "" },
  };

  const targetsById = new Map<string, TextTarget>(Object.entries(targets));

  return {
    targets,
    getElementById(elementId: string) {
      if (withMissingElement && elementId === "hud-status") {
        return null;
      }

      return targetsById.get(elementId) ?? null;
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
    expect(document.targets["hud-powerW"].textContent).toBe("0 W");

    bus.publish({ type: "trainer.data", tS: 1, powerW: 210, cadenceRpm: 95 });
    ticker.tick();
    expect(document.targets["hud-powerW"].textContent).toBe("210 W");

    app.stop();
    bus.publish({ type: "trainer.data", tS: 2, powerW: 250, cadenceRpm: 100 });
    ticker.tick();
    expect(document.targets["hud-powerW"].textContent).toBe("210 W");
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
