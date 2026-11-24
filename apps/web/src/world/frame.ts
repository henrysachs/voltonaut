import type { RideSnapshot } from "@voltonaut/engine";

import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  environmentAt,
  type EnvironmentSettings,
} from "./environment.js";
import type { FrameInput } from "./scheduler.js";

export type { EnvironmentSettings } from "./environment.js";

export function interpolateRide(
  previous: Readonly<RideSnapshot>,
  current: Readonly<RideSnapshot>,
  alpha: number,
): RideSnapshot {
  const fraction = Math.min(1, Math.max(0, alpha));
  const lerp = (start: number, end: number): number => start + (end - start) * fraction;

  const headingDelta = Math.atan2(
    Math.sin(current.headingRad - previous.headingRad),
    Math.cos(current.headingRad - previous.headingRad),
  );

  return {
    ...current,
    tS: lerp(previous.tS, current.tS),
    distanceM: lerp(previous.distanceM, current.distanceM),
    worldPos: {
      x: lerp(previous.worldPos.x, current.worldPos.x),
      y: lerp(previous.worldPos.y, current.worldPos.y),
      z: lerp(previous.worldPos.z, current.worldPos.z),
    },
    headingRad: previous.headingRad + headingDelta * fraction,
  };
}

export interface FrameSampler {
  readonly sample: (ride: Readonly<RideSnapshot>, nowMs: number) => FrameInput;
}

export function createFrameSampler(
  environment: Readonly<EnvironmentSettings> = DEFAULT_ENVIRONMENT_SETTINGS,
): FrameSampler {
  let previous: Readonly<RideSnapshot> | undefined;
  let current: Readonly<RideSnapshot> | undefined;
  let receivedMs = 0;
  let intervalMs = 50;
  let lastFrameMs: number | undefined;

  return {
    sample(ride, nowMs) {
      if (ride !== current) {
        previous = current ?? ride;
        current = ride;
        intervalMs = Math.max(1, Math.min(250, nowMs - receivedMs));
        receivedMs = nowMs;
      }

      const alpha = Math.min(1, Math.max(0, (nowMs - receivedMs) / intervalMs));
      const dtS = lastFrameMs === undefined ? 0 : Math.min(0.1, (nowMs - lastFrameMs) / 1000);

      lastFrameMs = nowMs;

      const sampledRide = interpolateRide(previous ?? ride, ride, alpha);

      return {
        ride: sampledRide,
        dtS,
        alpha,
        env: environmentAt(
          environment.seed,
          environment.startTimeS + sampledRide.tS,
          environment.script,
        ),
      };
    },
  };
}
