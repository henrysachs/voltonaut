import type { World } from "../types.js";
import { createWorld } from "../world.js";

import { SINGLE_ROUTE_WORLDS } from "./singleRouteWorlds.js";
import { VOLTONAUT_WORLD } from "./voltonaut.js";

export { SINGLE_ROUTE_WORLD_REVISION, TEST_WORLDS } from "./singleRouteWorlds.js";

/** The connected world voltonaut (ADR-033 step 3) with its tour and region loops. */
export const VOLTONAUT: World = createWorld(VOLTONAUT_WORLD);

/** Every shipped world by its stable id: the single-route worlds first, then the connected worlds. */
export const WORLD_REGISTRY = {
  ...SINGLE_ROUTE_WORLDS,
  voltonaut: VOLTONAUT,
} as const satisfies Readonly<Record<string, World>>;

export type WorldId = keyof typeof WORLD_REGISTRY;

/** Every shipped world in registry order. */
export const WORLDS: readonly World[] = Object.values(WORLD_REGISTRY);
