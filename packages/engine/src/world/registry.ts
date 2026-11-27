import type { WorldPathReference } from "@voltonaut/shared";

import type { RouteData } from "../elevation/route.js";

import type { World } from "./types.js";

/**
 * Resolves a recorded world path to the route data the tick receives (ADR-033 §3, §7). World and
 * revision must match exactly; there is no fallback to another revision.
 */
export function worldPathRoute(
  worlds: readonly World[],
  reference: WorldPathReference,
): RouteData | undefined {
  const world = worlds.find(
    (candidate) =>
      candidate.id === reference.worldId && candidate.revision === reference.worldRevision,
  );

  return world?.route(reference.pathId);
}
