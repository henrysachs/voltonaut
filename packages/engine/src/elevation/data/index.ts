import type { RouteData } from "../route.js";
import { WORLDS } from "../../world/data/index.js";

import { ALPINE_PASS } from "./alpine-pass.js";
import { COAST_LOOP } from "./coast-loop.js";
import { FLAT_LOOP } from "./flat-loop.js";
import { KOM_CLIMB } from "./kom-climb.js";
import { NIGHT_CITY } from "./night-city.js";
import { TEST_LOOP } from "./test-loop.js";

interface TestRouteRegistry {
  readonly [routeId: string]: RouteData | undefined;
}

/** Route data registry derived from the world paths; golden fixtures reference routes by id. */
export const TEST_ROUTES: TestRouteRegistry = Object.fromEntries(
  WORLDS.flatMap((world) => world.routes).map((route) => [route.id, route]),
);

export { ALPINE_PASS, COAST_LOOP, FLAT_LOOP, KOM_CLIMB, NIGHT_CITY, TEST_LOOP };
