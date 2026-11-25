import type { Meters, RideEvent, Seconds } from "@voltonaut/shared";

import type { EngineRoute } from "../elevation/route.js";
import type { RideState } from "./state.js";

export function crossedBoundaryM(
  previousM: Meters,
  nextM: Meters,
  boundaryM: Meters,
  loop: boolean,
): boolean {
  if (!loop || nextM >= previousM) {
    return boundaryM > previousM && boundaryM <= nextM;
  }

  // Wrapped tick: the rider passed (previousM, L] and [0, nextM].
  return boundaryM > previousM || boundaryM <= nextM;
}

export function applySegments(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- RideState is the engine-owned mutable state; only packages/engine/src/internal mutates it (depcruise engine-internal-private).
  state: RideState,
  route: EngineRoute,
  previousRoutePosM: Meters,
  nextRoutePosM: Meters,
  tS: Seconds,
): readonly RideEvent[] {
  const events: RideEvent[] = [];

  for (const segment of route.segments) {
    const crossedStart = crossedBoundaryM(
      previousRoutePosM,
      nextRoutePosM,
      segment.startM,
      route.loop,
    );

    const crossedEnd = crossedBoundaryM(previousRoutePosM, nextRoutePosM, segment.endM, route.loop);
    const active = state.activeSegments.includes(segment.id);

    if (crossedStart && !active) {
      state.activeSegments.push(segment.id);
      events.push({ type: "segment.entered", segmentId: segment.id, tS });
    }

    if (crossedEnd && state.activeSegments.includes(segment.id)) {
      state.activeSegments = state.activeSegments.filter((id) => id !== segment.id);
      events.push({ type: "segment.exited", segmentId: segment.id, tS });
    }
  }

  return events;
}
