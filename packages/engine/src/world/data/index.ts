import type { World } from "../types.js";
import { createWorld } from "../world.js";

import { FELSENTAL_WORLD } from "./felsental.js";
import { SINGLE_ROUTE_WORLDS, TEST_WORLDS } from "./singleRouteWorlds.js";
import { VOLTONAUT_WORLD, VOLTONAUT_WORLD_REVISION_2 } from "./voltonaut.js";

export { SINGLE_ROUTE_WORLD_REVISION, TEST_WORLDS } from "./singleRouteWorlds.js";

/** The connected world voltonaut (ADR-033 step 3) with its tour and region loops. */
export const VOLTONAUT: World = createWorld(VOLTONAUT_WORLD);

/** Revision 2 of voltonaut: the tour with the vineyard region (#146). New rides record it. */
export const VOLTONAUT_REVISION_2: World = createWorld(VOLTONAUT_WORLD_REVISION_2);

/** The stone-age theme world Felsental (#159, spec E10-16) with its valley loop. */
export const FELSENTAL: World = createWorld(FELSENTAL_WORLD);

/**
 * Every shipped world by its stable id, at the revision new rides record: the single-route worlds
 * first, then the native worlds in shipping order.
 */
export const WORLD_REGISTRY = {
  ...SINGLE_ROUTE_WORLDS,
  voltonaut: VOLTONAUT_REVISION_2,
  felsental: FELSENTAL,
} as const satisfies Readonly<Record<string, World>>;

export type WorldId = keyof typeof WORLD_REGISTRY;

/**
 * Every shipped world revision, so recordings of an older revision stay resolvable by
 * `worldPathRoute`. A world id lists its revisions oldest first; the newest comes last.
 */
export const WORLDS: readonly World[] = [
  ...TEST_WORLDS,
  VOLTONAUT,
  VOLTONAUT_REVISION_2,
  FELSENTAL,
];
