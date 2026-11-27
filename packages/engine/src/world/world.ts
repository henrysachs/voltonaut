import type { ElevationSample } from "../elevation/profile.js";
import type { CenterlinePoint, RouteData } from "../elevation/route.js";

import { assertSmoothCenterline } from "./curvature.js";
import type { EdgeLookup, OrientedEdge, RegionLookup } from "./edges.js";
import { assertUniqueIds, orient, validateEdge } from "./edges.js";
import { edgeViews, regionViews } from "./regions.js";
import type { World, WorldData, WorldPath } from "./types.js";

function orientedSteps(path: WorldPath, edgeById: EdgeLookup): OrientedEdge[] {
  if (path.steps.length === 0) {
    throw new RangeError(`path ${path.id} has no steps`);
  }

  const oriented: OrientedEdge[] = [];

  for (const step of path.steps) {
    const edge = edgeById(step.edgeId);

    if (edge === undefined) {
      throw new RangeError(`path ${path.id} references unknown edge ${step.edgeId}`);
    }

    const next = orient(edge, step.direction);
    const previous = oriented.at(-1);

    if (previous !== undefined && previous.endNodeId !== next.startNodeId) {
      throw new RangeError(`path ${path.id} is not connected at edge ${step.edgeId}`);
    }

    oriented.push(next);
  }

  if (path.loop && oriented[0]?.startNodeId !== oriented.at(-1)?.endNodeId) {
    throw new RangeError(`loop path ${path.id} does not return to its start node`);
  }

  return oriented;
}

/** A route takes the biome of the region it starts in; regions take over along the way. */
function startScenery(
  path: WorldPath,
  oriented: readonly OrientedEdge[],
  regionById: RegionLookup,
): string {
  const region = regionById(oriented[0]?.regionId ?? "");

  if (region === undefined) {
    throw new RangeError(`path ${path.id} starts outside every region`);
  }

  return region.scenery;
}

/**
 * Concatenates the oriented edges of a path into one route. Shared junction points and
 * samples appear once; a single forward edge yields its own arrays (bit-identical routes).
 */
function pathRouteData(
  path: WorldPath,
  edgeById: EdgeLookup,
  regionById: RegionLookup,
  smooth: boolean,
): RouteData {
  const oriented = orientedSteps(path, edgeById);
  const centerline: CenterlinePoint[] = [];
  const profileSamples: ElevationSample[] = [];
  let offsetM = 0;

  for (const [index, edge] of oriented.entries()) {
    const skip = index === 0 ? 0 : 1;

    centerline.push(...edge.centerline.slice(skip));

    for (const sample of edge.profileSamples.slice(skip)) {
      profileSamples.push({ distanceM: offsetM + sample.distanceM, elevationM: sample.elevationM });
    }

    offsetM += edge.lengthM;
  }

  if (smooth) assertSmoothCenterline(centerline, path.loop, `path ${path.id}`);

  return {
    id: path.id,
    name: path.name,
    lengthM: offsetM,
    loop: path.loop,
    centerline,
    profileSamples,
    segments: path.segments,
    scenery: startScenery(path, oriented, regionById),
  };
}

/** Validates the road network and derives one RouteData per path (ADR-033 step 1). */
export function createWorld(data: WorldData): World {
  if (data.revision.length === 0) {
    throw new RangeError(`world ${data.id} needs a revision`);
  }

  assertUniqueIds("region", data.regions);
  assertUniqueIds("node", data.nodes);
  assertUniqueIds("edge", data.edges);
  assertUniqueIds("path", data.paths);

  const regions = new Map(data.regions.map((region) => [region.id, region]));
  const regionById: RegionLookup = (regionId) => regions.get(regionId);
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const edges = new Map(data.edges.map((edge) => [edge.id, edge]));

  const smooth = data.legacyRoute !== true;

  for (const edge of data.edges) {
    validateEdge(edge, (nodeId) => nodes.get(nodeId), regionById, smooth);
  }

  const routes = data.paths.map((path) =>
    pathRouteData(path, (edgeId) => edges.get(edgeId), regionById, smooth),
  );

  const routesById = new Map(routes.map((route) => [route.id, route]));

  return {
    id: data.id,
    name: data.name,
    revision: data.revision,
    regions: regionViews(data),
    edges: edgeViews(data),
    routes,
    route: (pathId: string): RouteData | undefined => routesById.get(pathId),
  };
}
