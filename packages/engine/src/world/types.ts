import type { Meters } from "@voltonaut/shared";

import type { ElevationSample } from "../elevation/profile.js";
import type { CenterlinePoint, RouteData, SegmentDef } from "../elevation/route.js";

/** Junction or dead end of the road network; edges meet exactly at its XZ position (ADR-033). */
export interface WorldNode {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly elevationM: Meters;
}

/**
 * Area of a world with one biome (ADR-033 §6). Atmosphere and render budget belong to
 * apps/web/src/world and are keyed by the scenery id.
 */
export interface WorldRegion {
  readonly id: string;
  readonly name: string;
  readonly scenery: string;
}

/**
 * One drivable road section between two nodes. Curves are explicit polyline chords without
 * kinks (see curvature.ts); the profile runs from 0 to lengthM in the forward direction
 * (fromNodeId → toNodeId).
 */
export interface RoadEdge {
  readonly id: string;
  readonly regionId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly lengthM: Meters;
  readonly centerline: readonly CenterlinePoint[];
  readonly profileSamples: readonly ElevationSample[];
}

export type EdgeDirection = "forward" | "reverse";

export interface PathStep {
  readonly edgeId: string;
  readonly direction: EdgeDirection;
}

/** A named way through the world; the catalog lists these as routes (ADR-033 §4). */
export interface WorldPath {
  readonly id: string;
  readonly name: string;
  readonly loop: boolean;
  readonly steps: readonly PathStep[];
  /** Distances along the whole path from its first node; a segment may span several edges. */
  readonly segments: readonly SegmentDef[];
}

/** Pure world data: regions, road network and named paths. Revision changes with any geometry. */
export interface WorldData {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  /** Single-route wrappers keep legacy geometry bit-identical; new networks stay smooth. */
  readonly legacyRoute?: boolean;
  readonly regions: readonly WorldRegion[];
  readonly nodes: readonly WorldNode[];
  readonly edges: readonly RoadEdge[];
  readonly paths: readonly WorldPath[];
}

export interface World {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  /**
   * Route data of every path in declaration order; each one feeds createRoute unchanged.
   * Its scenery is the region of the first edge.
   */
  readonly routes: readonly RouteData[];
  /** Route data of one path, or undefined for an unknown path id. */
  readonly route: (pathId: string) => RouteData | undefined;
}
