import type { RideSnapshot } from "@voltonaut/engine";
import { gearLabel } from "@voltonaut/rules";
import type { SegmentHudRow, SegmentHudView, SegmentProgress } from "../game/segments.js";

/** Everything the HUD renders, merged from the engine snapshot and device status. */
export interface RideHudModel {
  readonly powerW: number;
  readonly cadenceRpm: number;
  readonly heartRateBpm: number | undefined;
  readonly gearIndex: number;
  readonly speedKmh: number;
  readonly distanceKm: number;
  readonly elevationGainM: number;
  readonly energyKj: number;
  readonly paused: boolean;
  readonly dataAgeS: number;
  readonly connected: boolean;
}

/** Builds the HUD model from a snapshot plus the device connection state. */
export function rideHudModelFrom(snapshot: RideSnapshot, connected: boolean): RideHudModel {
  return {
    powerW: snapshot.powerW,
    cadenceRpm: snapshot.cadenceRpm,
    heartRateBpm: snapshot.hrBpm,
    gearIndex: snapshot.gear.index,
    speedKmh: snapshot.speedMps * 3.6,
    distanceKm: snapshot.distanceM / 1000,
    elevationGainM: snapshot.elevationGainM,
    energyKj: snapshot.energyKj,
    paused: snapshot.paused,
    dataAgeS: snapshot.dataAgeS,
    connected,
  };
}

export interface HudText {
  readonly powerW: string;
  readonly cadenceRpm: string;
  readonly heartRateBpm: string;
  readonly gear: string;
  readonly status: string;
  readonly speed: string;
  readonly distance: string;
  readonly elevationGain: string;
  readonly energy: string;
  readonly warning: string;
}

/** Sink for one HUD value. DOM adapters write the text into the real element. */
export interface TextTarget {
  readonly write: (text: string) => void;
}

export interface HudTargets {
  readonly sprint: TextTarget;
  readonly kom: TextTarget;
  readonly powerW: TextTarget;
  readonly cadenceRpm: TextTarget;
  readonly heartRateBpm: TextTarget;
  readonly gear: TextTarget;
  readonly status: TextTarget;
  readonly speed: TextTarget;
  readonly distance: TextTarget;
  readonly elevationGain: TextTarget;
  readonly energy: TextTarget;
  readonly warning: TextTarget;
}

const INVALID_SEGMENT_LABELS: Readonly<
  Record<Extract<SegmentProgress, { readonly kind: "invalid" }>["reason"], string>
> = {
  clock_skipped: "Zeitlücke",
  missing_entry: "Start fehlt",
  engine_unavailable: "Engine nicht verfügbar",
  invalid_timing: "Zeitfolge unvollständig",
};

function segmentText(row: SegmentHudRow): string {
  const { progress, segment } = row;

  switch (progress.kind) {
    case "idle":
      return `${segment.name} · ab ${(segment.startM / 1000).toFixed(1)} km`;
    case "active":
      return `${segment.name} · R${progress.lap + 1} · ${progress.elapsedS.toFixed(1)} s · noch ${Math.ceil(progress.remainingM)} m`;
    case "finished":
      return `${segment.name} · R${progress.lap + 1} · ${progress.timeS.toFixed(1)} s · vorläufig`;
    case "invalid":
      return `${segment.name} · ungültig · ${INVALID_SEGMENT_LABELS[progress.reason]}`;
    default: {
      const exhaustive: never = progress;

      return exhaustive;
    }
  }
}

export function renderSegmentHud(
  view: SegmentHudView,
  targets: Pick<HudTargets, "sprint" | "kom">,
): void {
  const kinds: readonly ("sprint" | "kom")[] = ["sprint", "kom"];

  for (const kind of kinds) {
    const texts: string[] = [];

    for (const row of view.rows) {
      if (row.segment.kind === kind) texts.push(segmentText(row));
    }

    targets[kind].write(texts.join(" / "));
  }
}

/** Data-loss warning threshold from docs/03 section 1 (> 3 s without data). */
export const DATA_AGE_WARNING_S = 3;

export function hudText(model: RideHudModel, connectedLabel = "Sim connected"): HudText {
  const status = model.paused
    ? "Paused (auto)"
    : model.connected
      ? connectedLabel
      : "Waiting for devices";

  return {
    powerW: `${Math.round(model.powerW)} W`,
    cadenceRpm: `${Math.round(model.cadenceRpm)} rpm`,
    heartRateBpm: `${Math.round(model.heartRateBpm ?? 0)} bpm`,
    gear: gearLabel(model.gearIndex),
    status,
    speed: `${(Math.round(model.speedKmh * 10) / 10).toFixed(1)} km/h`,
    distance: `${(Math.round(model.distanceKm * 100) / 100).toFixed(2)} km`,
    elevationGain: `${Math.round(model.elevationGainM)} m`,
    energy: `${Math.round(model.energyKj)} kJ`,
    warning: model.dataAgeS > DATA_AGE_WARNING_S ? "No trainer data" : "",
  };
}

export function renderHud(
  model: RideHudModel,
  targets: HudTargets,
  connectedLabel = "Sim connected",
): void {
  const text = hudText(model, connectedLabel);
  targets.powerW.write(text.powerW);
  targets.cadenceRpm.write(text.cadenceRpm);
  targets.heartRateBpm.write(text.heartRateBpm);
  targets.gear.write(text.gear);
  targets.status.write(text.status);
  targets.speed.write(text.speed);
  targets.distance.write(text.distance);
  targets.elevationGain.write(text.elevationGain);
  targets.energy.write(text.energy);
  targets.warning.write(text.warning);
}
