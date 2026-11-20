import type { RouteData } from "../route.js";

import { FLAT_LOOP } from "./flat-loop.js";
import { KOM_CLIMB } from "./kom-climb.js";
import { TEST_LOOP } from "./test-loop.js";

interface TestRouteRegistry {
  readonly [routeId: string]: RouteData | undefined;
}

/** Route data registry; golden fixtures reference routes by id. */
export const TEST_ROUTES: TestRouteRegistry = {
  "flat-loop": FLAT_LOOP,
  "test-loop": TEST_LOOP,
  "kom-climb": KOM_CLIMB,
};

export { FLAT_LOOP, KOM_CLIMB, TEST_LOOP };
