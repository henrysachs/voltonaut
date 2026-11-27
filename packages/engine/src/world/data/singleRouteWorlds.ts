import { ALPINE_PASS } from "../../elevation/data/alpine-pass.js";
import { COAST_LOOP } from "../../elevation/data/coast-loop.js";
import { FLAT_LOOP } from "../../elevation/data/flat-loop.js";
import { KOM_CLIMB } from "../../elevation/data/kom-climb.js";
import { NIGHT_CITY } from "../../elevation/data/night-city.js";
import { TEST_LOOP } from "../../elevation/data/test-loop.js";
import type { RouteData } from "../../elevation/route.js";
import { singleRouteWorld } from "../singleRouteWorld.js";
import type { World } from "../types.js";
import { createWorld } from "../world.js";

/** Revision of the migrated single-route worlds; matches the recorded routeRevision "1". */
export const SINGLE_ROUTE_WORLD_REVISION = "1";

function singleRoute(route: RouteData): World {
  return createWorld(singleRouteWorld(route, SINGLE_ROUTE_WORLD_REVISION));
}

/** Every shipped route as its own world with one edge and one path (ADR-033 step 1). */
export const SINGLE_ROUTE_WORLDS = {
  "flat-loop": singleRoute(FLAT_LOOP),
  "test-loop": singleRoute(TEST_LOOP),
  "kom-climb": singleRoute(KOM_CLIMB),
  "coast-loop": singleRoute(COAST_LOOP),
  "alpine-pass": singleRoute(ALPINE_PASS),
  "night-city": singleRoute(NIGHT_CITY),
} as const satisfies Readonly<Record<string, World>>;

export const TEST_WORLDS: readonly World[] = Object.values(SINGLE_ROUTE_WORLDS);
