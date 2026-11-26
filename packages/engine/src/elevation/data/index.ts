import type { RouteData } from "../route.js";

import { ALPINE_PASS } from "./alpine-pass.js";
import { COAST_LOOP } from "./coast-loop.js";
import { FLAT_LOOP } from "./flat-loop.js";
import { KOM_CLIMB } from "./kom-climb.js";
import { NIGHT_CITY } from "./night-city.js";
import { TEST_LOOP } from "./test-loop.js";

interface TestRouteRegistry {
  readonly [routeId: string]: RouteData | undefined;
}

/** Route data registry; golden fixtures reference routes by id. */
export const TEST_ROUTES: TestRouteRegistry = {
  "flat-loop": FLAT_LOOP,
  "test-loop": TEST_LOOP,
  "kom-climb": KOM_CLIMB,
  "coast-loop": COAST_LOOP,
  "alpine-pass": ALPINE_PASS,
  "night-city": NIGHT_CITY,
};

export { ALPINE_PASS, COAST_LOOP, FLAT_LOOP, KOM_CLIMB, NIGHT_CITY, TEST_LOOP };
