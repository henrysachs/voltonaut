import type { WorldPathReference } from "@voltonaut/shared";

import type { RouteData } from "../../elevation/route.js";

import { WORLD_REGISTRY, type WorldId } from "./index.js";

/**
 * Recordings of one route the server recomputes (ADR-016). Every other reference stays
 * unverified/unknown_revision and earns no XP or Volts (PR #138), so each route states both.
 */
export interface ReplayPolicy {
  /** World revision of replayable world-path rides (ADR-033 §7); each needs its own replay tests. */
  readonly worldRevision: string | undefined;
  /** Revision of replayable stored single-route rides from before worlds (ADR-033 §8). */
  readonly legacyRouteRevision: "1" | undefined;
}

export interface RouteEntry {
  readonly worldId: WorldId;
  readonly replay: ReplayPolicy;
}

/** Routes that shipped before worlds: their stored single-route rides stay replayable. */
const SINGLE_ROUTE_REPLAY: ReplayPolicy = { worldRevision: "1", legacyRouteRevision: "1" };

/** Paths of native worlds (connected or themed) never had single-route recordings. */
const NATIVE_WORLD_REPLAY: ReplayPolicy = { worldRevision: "1", legacyRouteRevision: undefined };

/**
 * Every path of every shipped world by its stable route id (ADR-033 §8). An entry cannot omit its
 * replay policy, so no route ships without deciding how the server scores its rides.
 */
export const ROUTE_REGISTRY = {
  "flat-loop": { worldId: "flat-loop", replay: SINGLE_ROUTE_REPLAY },
  "test-loop": { worldId: "test-loop", replay: SINGLE_ROUTE_REPLAY },
  "kom-climb": { worldId: "kom-climb", replay: SINGLE_ROUTE_REPLAY },
  "coast-loop": { worldId: "coast-loop", replay: SINGLE_ROUTE_REPLAY },
  "alpine-pass": { worldId: "alpine-pass", replay: SINGLE_ROUTE_REPLAY },
  "night-city": { worldId: "night-city", replay: SINGLE_ROUTE_REPLAY },
  "voltonaut-tour": { worldId: "voltonaut", replay: NATIVE_WORLD_REPLAY },
  "voltonaut-forest": { worldId: "voltonaut", replay: NATIVE_WORLD_REPLAY },
  "voltonaut-coast": { worldId: "voltonaut", replay: NATIVE_WORLD_REPLAY },
  "voltonaut-night-city": { worldId: "voltonaut", replay: NATIVE_WORLD_REPLAY },
  felsental: { worldId: "felsental", replay: NATIVE_WORLD_REPLAY },
} as const satisfies Readonly<Record<string, RouteEntry>>;

export type RouteId = keyof typeof ROUTE_REGISTRY;

function isRouteId(value: string): value is RouteId {
  return Object.hasOwn(ROUTE_REGISTRY, value);
}

/** Route id from untrusted text (URL, recording); inherited names such as "constructor" are no ids. */
export function parseRouteId(value: string): RouteId | undefined {
  return isRouteId(value) ? value : undefined;
}

/** Route data of a registered route from its world; routes.test.ts pins that every one resolves. */
export function registeredRoute(routeId: RouteId): RouteData | undefined {
  return WORLD_REGISTRY[ROUTE_REGISTRY[routeId].worldId].route(routeId);
}

/** The world reference a new ride on this route records (ADR-033 §7). */
export function routeWorldPath(routeId: RouteId): WorldPathReference {
  const { worldId } = ROUTE_REGISTRY[routeId];

  return { worldId, worldRevision: WORLD_REGISTRY[worldId].revision, pathId: routeId };
}
