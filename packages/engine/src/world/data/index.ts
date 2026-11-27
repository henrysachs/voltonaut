import type { World } from "../types.js";
import { createWorld } from "../world.js";

import { FELSENTAL_WORLD } from "./felsental.js";
import { TEST_WORLDS } from "./singleRouteWorlds.js";
import { VOLTONAUT_WORLD } from "./voltonaut.js";

export { SINGLE_ROUTE_WORLD_REVISION, TEST_WORLDS } from "./singleRouteWorlds.js";

/** The connected world voltonaut (ADR-033 step 3) with its tour and region loops. */
export const VOLTONAUT: World = createWorld(VOLTONAUT_WORLD);

/** The stone-age theme world Felsental (#159, spec E10-16) with its valley loop. */
export const FELSENTAL: World = createWorld(FELSENTAL_WORLD);

/** Every shipped world: the single-route worlds first, then the native worlds in shipping order. */
export const WORLDS: readonly World[] = [...TEST_WORLDS, VOLTONAUT, FELSENTAL];
