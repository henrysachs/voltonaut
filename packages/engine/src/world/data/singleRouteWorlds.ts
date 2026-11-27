import { ALPINE_PASS } from "../../elevation/data/alpine-pass.js";
import { COAST_LOOP } from "../../elevation/data/coast-loop.js";
import { FLAT_LOOP } from "../../elevation/data/flat-loop.js";
import { KOM_CLIMB } from "../../elevation/data/kom-climb.js";
import { NIGHT_CITY } from "../../elevation/data/night-city.js";
import { TEST_LOOP } from "../../elevation/data/test-loop.js";
import { singleRouteWorld } from "../singleRouteWorld.js";
import type { World } from "../types.js";
import { createWorld } from "../world.js";

/** Revision of the migrated single-route worlds; matches the recorded routeRevision "1". */
export const SINGLE_ROUTE_WORLD_REVISION = "1";

/** Every shipped route as its own world with one edge and one path (ADR-033 step 1). */
export const TEST_WORLDS: readonly World[] = [
  FLAT_LOOP,
  TEST_LOOP,
  KOM_CLIMB,
  COAST_LOOP,
  ALPINE_PASS,
  NIGHT_CITY,
].map((route) => createWorld(singleRouteWorld(route, SINGLE_ROUTE_WORLD_REVISION)));
