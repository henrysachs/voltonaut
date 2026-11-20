import type { TickSource } from "@voltonaut/ble";
import { createIntervalTicker } from "@voltonaut/ble";
import type { RideSnapshot } from "@voltonaut/engine";

import { renderHud } from "./ui/hud.js";
import type { HudTargets, TextTarget } from "./ui/hud.js";
import { rideHudModelFrom } from "./ui/hud.js";

const HUD_INTERVAL_MS = 100;

const HUD_ELEMENT_IDS = [
  "powerW",
  "cadenceRpm",
  "heartRateBpm",
  "gear",
  "status",
  "speed",
  "distance",
  "elevationGain",
  "energy",
  "warning",
] as const;

export interface AppDocument {
  readonly querySelector: (selector: string) => TextTarget | null;
}

/** Snapshot + connection state source the HUD renders from. */
export interface RideHudSource {
  readonly snapshot: () => RideSnapshot | undefined;
  readonly connected: () => boolean;
  readonly dispose: () => void;
}

export interface StartAppOptions {
  readonly document: AppDocument;
  readonly ride: RideHudSource;
  readonly ticker?: TickSource;
}

export interface App {
  readonly render: () => void;
  readonly stop: () => void;
}

interface OptionalHudTargets {
  readonly powerW: TextTarget | undefined;
  readonly cadenceRpm: TextTarget | undefined;
  readonly heartRateBpm: TextTarget | undefined;
  readonly gear: TextTarget | undefined;
  readonly status: TextTarget | undefined;
  readonly speed: TextTarget | undefined;
  readonly distance: TextTarget | undefined;
  readonly elevationGain: TextTarget | undefined;
  readonly energy: TextTarget | undefined;
  readonly warning: TextTarget | undefined;
}

function hudTargetsFrom(targets: OptionalHudTargets): HudTargets | undefined {
  const {
    powerW,
    cadenceRpm,
    heartRateBpm,
    gear,
    status,
    speed,
    distance,
    elevationGain,
    energy,
    warning,
  } = targets;

  if (
    powerW === undefined ||
    cadenceRpm === undefined ||
    heartRateBpm === undefined ||
    gear === undefined ||
    status === undefined ||
    speed === undefined ||
    distance === undefined ||
    elevationGain === undefined ||
    energy === undefined ||
    warning === undefined
  ) {
    return undefined;
  }

  return {
    powerW,
    cadenceRpm,
    heartRateBpm,
    gear,
    status,
    speed,
    distance,
    elevationGain,
    energy,
    warning,
  };
}

function readHudTargets(document: AppDocument): HudTargets | undefined {
  const target = (elementId: (typeof HUD_ELEMENT_IDS)[number]): TextTarget | undefined =>
    document.querySelector(`#hud-${elementId}`) ?? undefined;

  return hudTargetsFrom({
    powerW: target("powerW"),
    cadenceRpm: target("cadenceRpm"),
    heartRateBpm: target("heartRateBpm"),
    gear: target("gear"),
    status: target("status"),
    speed: target("speed"),
    distance: target("distance"),
    elevationGain: target("elevationGain"),
    energy: target("energy"),
    warning: target("warning"),
  });
}

export function startApp(options: StartAppOptions): App {
  const targets = readHudTargets(options.document);

  if (targets === undefined) {
    throw new Error("HUD elements are missing from the document");
  }

  const ticker = options.ticker ?? createIntervalTicker(HUD_INTERVAL_MS);

  const render = (): void => {
    const snapshot = options.ride.snapshot();

    if (snapshot === undefined) {
      return;
    }

    renderHud(rideHudModelFrom(snapshot, options.ride.connected()), targets);
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
