import type { TickSource } from "@voltonaut/ble";
import { createIntervalTicker } from "@voltonaut/ble";

import type { SimRide } from "./game/simRide.js";
import { renderHud } from "./ui/hud.js";
import type { HudTargets, TextTarget } from "./ui/hud.js";

const HUD_INTERVAL_MS = 100;
const HUD_ELEMENT_IDS = ["powerW", "cadenceRpm", "heartRateBpm", "gear", "status"] as const;

export interface AppDocument {
  readonly querySelector: (selector: string) => TextTarget | null;
}

export interface StartAppOptions {
  readonly document: AppDocument;
  readonly ride: SimRide;
  readonly ticker?: TickSource;
}

export interface App {
  readonly render: () => void;
  readonly stop: () => void;
}

function readHudTargets(document: AppDocument): HudTargets | undefined {
  const foundTargets = new Map<string, TextTarget>();

  for (const elementId of HUD_ELEMENT_IDS) {
    const element = document.querySelector(`#hud-${elementId}`);

    if (element === null) {
      return undefined;
    }

    foundTargets.set(elementId, element);
  }

  const powerW = foundTargets.get("powerW");
  const cadenceRpm = foundTargets.get("cadenceRpm");
  const heartRateBpm = foundTargets.get("heartRateBpm");
  const gear = foundTargets.get("gear");
  const status = foundTargets.get("status");

  if (
    powerW === undefined ||
    cadenceRpm === undefined ||
    heartRateBpm === undefined ||
    gear === undefined ||
    status === undefined
  ) {
    return undefined;
  }

  return { powerW, cadenceRpm, heartRateBpm, gear, status };
}

export function startApp(options: StartAppOptions): App {
  const targets = readHudTargets(options.document);

  if (targets === undefined) {
    throw new Error("HUD elements are missing from the document");
  }

  const ticker = options.ticker ?? createIntervalTicker(HUD_INTERVAL_MS);

  const render = (): void => {
    renderHud(options.ride.state(), targets);
  };

  render();
  const stopTicker = ticker.start(render);

  return {
    render,
    stop() {
      stopTicker();
      options.ride.dispose();
    },
  };
}
