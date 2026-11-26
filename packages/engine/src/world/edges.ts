import type { Meters } from "@voltonaut/shared";

import type { ElevationSample } from "../elevation/profile.js";
import type { CenterlinePoint } from "../elevation/route.js";

import { assertSmoothCenterline } from "./curvature.js";
import type { EdgeDirection, RoadEdge, WorldNode, WorldRegion } from "./types.js";

export type NodeLookup = (nodeId: string) => WorldNode | undefined;

export type RegionLookup = (regionId: string) => WorldRegion | undefined;

export type EdgeLookup = (edgeId: string) => RoadEdge | undefined;

const NODE_ELEVATION_TOLERANCE_M = 1e-6;
const EDGE_LENGTH_TOLERANCE_M = 1e-6;

export interface OrientedEdge {
  readonly regionId: string;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly lengthM: Meters;
  readonly centerline: readonly CenterlinePoint[];
  readonly profileSamples: readonly ElevationSample[];
}

export function assertUniqueIds(kind: string, items: readonly { readonly id: string }[]): void {
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      throw new RangeError(`duplicate ${kind} id ${item.id}`);
    }

    seen.add(item.id);
  }
}

function arcLengthM(points: readonly CenterlinePoint[]): Meters {
  let totalM = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (previous !== undefined && current !== undefined) {
      totalM += Math.hypot(current.x - previous.x, current.z - previous.z);
    }
  }

  return totalM;
}

function assertNodeAt(
  edge: RoadEdge,
  node: WorldNode,
  point: CenterlinePoint | undefined,
  sample: ElevationSample | undefined,
): void {
  if (point?.x !== node.x || point.z !== node.z) {
    throw new RangeError(`edge ${edge.id} does not meet node ${node.id} exactly`);
  }

  if (
    sample === undefined ||
    Math.abs(sample.elevationM - node.elevationM) > NODE_ELEVATION_TOLERANCE_M
  ) {
    throw new RangeError(`edge ${edge.id} elevation does not match node ${node.id}`);
  }
}

export function validateEdge(
  edge: RoadEdge,
  nodeById: NodeLookup,
  regionById: RegionLookup,
  smooth = true,
): void {
  if (regionById(edge.regionId) === undefined) {
    throw new RangeError(`edge ${edge.id} references unknown region ${edge.regionId}`);
  }

  const fromNode = nodeById(edge.fromNodeId);
  const toNode = nodeById(edge.toNodeId);

  if (fromNode === undefined || toNode === undefined) {
    throw new RangeError(`edge ${edge.id} references an unknown node`);
  }

  if (edge.centerline.length < 2 || edge.profileSamples.length < 2) {
    throw new RangeError(`edge ${edge.id} needs at least 2 centerline points and samples`);
  }

  if (edge.lengthM <= 0 || !Number.isFinite(edge.lengthM)) {
    throw new RangeError(`edge ${edge.id} lengthM must be positive and finite`);
  }

  if (Math.abs(arcLengthM(edge.centerline) - edge.lengthM) > EDGE_LENGTH_TOLERANCE_M) {
    throw new RangeError(`edge ${edge.id} centerline arc length does not match lengthM`);
  }

  if (
    edge.profileSamples[0]?.distanceM !== 0 ||
    edge.profileSamples.at(-1)?.distanceM !== edge.lengthM
  ) {
    throw new RangeError(`edge ${edge.id} profile must span exactly 0 to lengthM`);
  }

  assertNodeAt(edge, fromNode, edge.centerline[0], edge.profileSamples[0]);
  assertNodeAt(edge, toNode, edge.centerline.at(-1), edge.profileSamples.at(-1));

  if (smooth) assertSmoothCenterline(edge.centerline, false, `edge ${edge.id}`);
}

export function orient(edge: RoadEdge, direction: EdgeDirection): OrientedEdge {
  if (direction === "forward") {
    return {
      regionId: edge.regionId,
      startNodeId: edge.fromNodeId,
      endNodeId: edge.toNodeId,
      lengthM: edge.lengthM,
      centerline: edge.centerline,
      profileSamples: edge.profileSamples,
    };
  }

  return {
    regionId: edge.regionId,
    startNodeId: edge.toNodeId,
    endNodeId: edge.fromNodeId,
    lengthM: edge.lengthM,
    centerline: edge.centerline.toReversed(),
    profileSamples: edge.profileSamples
      .map((sample) => ({
        distanceM: edge.lengthM - sample.distanceM,
        elevationM: sample.elevationM,
      }))
      .toReversed(),
  };
}
