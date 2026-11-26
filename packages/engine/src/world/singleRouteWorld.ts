import type { RouteData } from "../elevation/route.js";

import type { RoadEdge, WorldData, WorldNode, WorldPath } from "./types.js";

interface RouteEnds {
  readonly startNode: WorldNode;
  readonly endNode: WorldNode;
}

function routeEnds(route: RouteData): RouteEnds {
  const start = route.centerline[0];
  const end = route.centerline.at(-1);
  const startSample = route.profileSamples[0];
  const endSample = route.profileSamples.at(-1);

  if (
    start === undefined ||
    end === undefined ||
    startSample === undefined ||
    endSample === undefined
  ) {
    throw new RangeError(`route ${route.id} has no centerline or profile`);
  }

  return {
    startNode: {
      id: `${route.id}:start`,
      x: start.x,
      z: start.z,
      elevationM: startSample.elevationM,
    },
    endNode: { id: `${route.id}:end`, x: end.x, z: end.z, elevationM: endSample.elevationM },
  };
}

function routeEdge(route: RouteData, ends: RouteEnds): RoadEdge {
  return {
    id: route.id,
    fromNodeId: ends.startNode.id,
    toNodeId: route.loop ? ends.startNode.id : ends.endNode.id,
    lengthM: route.lengthM,
    regionId: route.id,
    centerline: route.centerline,
    profileSamples: route.profileSamples,
  };
}

function routePath(route: RouteData): WorldPath {
  return {
    id: route.id,
    name: route.name,
    loop: route.loop,
    steps: [{ edgeId: route.id, direction: "forward" }],
    segments: route.segments,
  };
}

/**
 * Wraps a standalone route as a world with one region, one edge and one path (ADR-033 step 1).
 * The derived route equals the input field by field.
 */
export function singleRouteWorld(route: RouteData, revision: string): WorldData {
  const ends = routeEnds(route);

  return {
    id: route.id,
    name: route.name,
    revision,
    legacyRoute: true,
    regions: [{ id: route.id, name: route.name, scenery: route.scenery }],
    nodes: route.loop ? [ends.startNode] : [ends.startNode, ends.endNode],
    edges: [routeEdge(route, ends)],
    paths: [routePath(route)],
  };
}
