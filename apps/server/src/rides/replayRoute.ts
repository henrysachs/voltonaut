import { TEST_ROUTES, WORLDS, worldPathRoute, type RouteData } from "@voltonaut/engine";
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
 * Single routes recorded before worlds existed (routeRevision "1"); each is also its own world
 * with revision "1" (ADR-033 §8). Worlds added since then never had route recordings.
 */
const LEGACY_ROUTE_IDS: readonly string[] = [
  "flat-loop",
  "test-loop",
  "kom-climb",
  "coast-loop",
  "alpine-pass",
  "night-city",
];

/** World revisions this server replays. Each one needs its own replay tests (ADR-033). */
const REPLAYABLE_WORLDS: readonly { readonly worldId: string; readonly worldRevision: string }[] = [
  ...LEGACY_ROUTE_IDS.map((worldId) => ({ worldId, worldRevision: "1" })),
  { worldId: "voltonaut", worldRevision: "1" },
  { worldId: "felsental", worldRevision: "1" },
];

const REPLAYABLE_ROUTE_IDS = new Set(LEGACY_ROUTE_IDS);

/**
 * Resolves the recorded reference internally (ADR-016). Unknown worlds, revisions, paths and
 * routes yield undefined; there is no fallback to the newest world.
 */
export function replayRoute(
  initialization: RecordingV2["initialization"],
): ReplayRoute | undefined {
  if (!isWorldPathReference(initialization)) {
    // The single-route revision from before worlds stays replayable (ADR-033 §8).
    if (initialization.routeRevision !== "1" || !REPLAYABLE_ROUTE_IDS.has(initialization.routeId))
      return undefined;
    const route = TEST_ROUTES[initialization.routeId];

    return route === undefined ? undefined : { route, replayRevision: undefined };
  }

  const replayable = REPLAYABLE_WORLDS.some(
    (world) =>
      world.worldId === initialization.worldId &&
      world.worldRevision === initialization.worldRevision,
  );

  const route = replayable ? worldPathRoute(WORLDS, initialization) : undefined;

  return route === undefined ? undefined : { route, replayRevision: WORLD_PATH_REPLAY_REVISION };
}
