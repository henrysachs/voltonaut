import { ALPINE_PASS } from "../../elevation/data/alpine-pass.js";
import { COAST_LOOP } from "../../elevation/data/coast-loop.js";
import { FLAT_LOOP } from "../../elevation/data/flat-loop.js";
import { KOM_CLIMB } from "../../elevation/data/kom-climb.js";
import { NIGHT_CITY } from "../../elevation/data/night-city.js";
import { TEST_LOOP } from "../../elevation/data/test-loop.js";
import { singleRouteWorld } from "../singleRouteWorld.js";
import type { World } from "../types.js";
import { createWorld } from "../world.js";

import { FELSENTAL_WORLD } from "./felsental.js";
import { VOLTONAUT_WORLD } from "./voltonaut.js";

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

/** The connected world voltonaut (ADR-033 step 3) with its tour and region loops. */
export const VOLTONAUT: World = createWorld(VOLTONAUT_WORLD);

/** The stone-age theme world Felsental (#159, spec E10-15) with its valley loop. */
export const FELSENTAL: World = createWorld(FELSENTAL_WORLD);

/** Every shipped world: the single-route worlds first, then the native worlds in shipping order. */
export const WORLDS: readonly World[] = [...TEST_WORLDS, VOLTONAUT, FELSENTAL];
