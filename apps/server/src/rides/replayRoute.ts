import {
  parseRouteId,
  registeredRoute,
  ROUTE_REGISTRY,
  WORLDS,
  worldPathRoute,
  type RouteData,
} from "@voltonaut/engine";
import {
  isWorldPathReference,
  WORLD_PATH_REPLAY_REVISION,
  type RecordingV2,
} from "@voltonaut/shared";

export interface ReplayRoute {
  readonly route: RouteData;
  /** Set for world paths; single-route replays keep their stored assessment form. */
  readonly replayRevision: typeof WORLD_PATH_REPLAY_REVISION | undefined;
}

/**
 * Resolves the recorded reference internally (ADR-016) against each route's replay policy in the
 * engine registry. Unknown worlds, revisions, paths and routes yield undefined; there is no
 * fallback to the newest world.
 */
export function replayRoute(
  initialization: RecordingV2["initialization"],
): ReplayRoute | undefined {
  if (!isWorldPathReference(initialization)) {
    const routeId = parseRouteId(initialization.routeId);

    // The single-route revision from before worlds stays replayable (ADR-033 §8).
    if (
      routeId === undefined ||
      ROUTE_REGISTRY[routeId].replay.legacyRouteRevision !== initialization.routeRevision
    )
      return undefined;
    const route = registeredRoute(routeId);

    return route === undefined ? undefined : { route, replayRevision: undefined };
  }

  const routeId = parseRouteId(initialization.pathId);

  if (routeId === undefined) return undefined;
  const { worldId, replay } = ROUTE_REGISTRY[routeId];

  if (
    worldId !== initialization.worldId ||
    !replay.worldRevisions.includes(initialization.worldRevision)
  )
    return undefined;
  // The shipped world must still carry the recorded revision; geometry never falls back.
  const route = worldPathRoute(WORLDS, initialization);

  return route === undefined ? undefined : { route, replayRevision: WORLD_PATH_REPLAY_REVISION };
}
