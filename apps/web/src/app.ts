import type { TickSource } from "@voltonaut/ble";
import { createIntervalTicker } from "@voltonaut/ble";
import type { RideSnapshot } from "@voltonaut/engine";
import type { SegmentHudView } from "./game/segments.js";

import { renderHud, renderSegmentHud } from "./ui/hud.js";
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
  "sprint",
  "kom",
  "item",
] as const;

export interface AppDocument {
  readonly querySelector: (selector: string) => TextTarget | null;
}

/** Snapshot + connection state source the HUD renders from. */
export interface RideHudSource {
  readonly snapshot: () => RideSnapshot | undefined;
  readonly connected: () => boolean;
  readonly segments: () => SegmentHudView;
  readonly dispose: () => void;
}

export interface StartAppOptions {
  readonly document: AppDocument;
  readonly ride: RideHudSource;
  readonly ticker?: TickSource;
  readonly connectedLabel?: string;
}

export interface App {
  readonly render: () => void;
  readonly stop: () => void;
}

type OptionalHudTargets = { readonly [K in keyof HudTargets]: TextTarget | undefined };

/** True when every HUD element exists; HUD_ELEMENT_IDS lists every HudTargets key. */
function allHudTargets(targets: OptionalHudTargets): targets is HudTargets {
  return HUD_ELEMENT_IDS.every((id) => targets[id] !== undefined);
}

function hudTargetsFrom(targets: OptionalHudTargets): HudTargets | undefined {
  return allHudTargets(targets) ? targets : undefined;
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
    sprint: target("sprint"),
    kom: target("kom"),
    item: target("item"),
  });
}

export function startApp(options: StartAppOptions): App {
  const targets = readHudTargets(options.document);

  if (targets === undefined) {
    throw new Error("HUD elements are missing from the document");
  }

  const ticker = options.ticker ?? createIntervalTicker(HUD_INTERVAL_MS);

  const render = (): void => {
    renderSegmentHud(options.ride.segments(), targets);
    const snapshot = options.ride.snapshot();

    if (snapshot === undefined) {
      return;
    }

    renderHud(
      rideHudModelFrom(snapshot, options.ride.connected()),
      targets,
      options.connectedLabel,
    );
  };

  render();
  const stopTicker = ticker.start(render);

  return {
    render,
    stop() {
      stopTicker();
      options.ride.dispose();
      renderSegmentHud(options.ride.segments(), targets);
    },
  };
}
