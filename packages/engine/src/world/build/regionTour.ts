import type { CenterlinePoint, RouteData, SegmentDef } from "../../elevation/route.js";
import type { PathStep, RoadEdge, WorldData, WorldNode, WorldPath } from "../types.js";

import {
  chordHeadingRad,
  cumulativeLengths,
  cutPiece,
  type RoadPiece,
  type SourceRoad,
  vertexFacing,
} from "./polyline.js";
import { transitionRoad, type RoadEnd } from "./transition.js";

/** One region of a tour world: its own loop, moved to its place in the world. */
export interface TourRegion {
  readonly id: string;
  readonly name: string;
  readonly scenery: string;
  readonly loop: RouteData;
  readonly offset: CenterlinePoint;
  /** Catalog name of the region's own loop path; defaults to the region name. */
  readonly pathName?: string;
  /** Carries the loop's segments over to its path, moved to start at the region's entry. */
  readonly keepSegments?: boolean;
}

export interface TourWorldSpec {
  readonly id: string;
  readonly name: string;
  readonly revision: string;
  readonly tourId: string;
  readonly tourName: string;
  /** Visited in this order; the tour returns from the last region to the first. */
  readonly regions: readonly TourRegion[];
  readonly chordM: number;
  /** Transitions keep the grade of the loops at their junctions instead of levelling out. */
  readonly matchGrades?: boolean;
}

interface PlacedRegion {
  readonly region: TourRegion;
  readonly road: SourceRoad;
  readonly entry: number;
  readonly exit: number;
  readonly center: CenterlinePoint;
}

function moved(region: TourRegion): SourceRoad {
  return {
    closed: true,
    profileSamples: region.loop.profileSamples,
    centerline: region.loop.centerline.map((point) => ({
      x: point.x + region.offset.x,
      z: point.z + region.offset.z,
    })),
  };
}

function headingTo(from: CenterlinePoint, to: CenterlinePoint): number {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

/** Leaves towards the next region and arrives from the previous one along the loop tangent. */
function place(regions: readonly TourRegion[], index: number): PlacedRegion {
  const count = regions.length;
  const region = regions[index];
  const previous = regions[(index - 1 + count) % count];
  const next = regions[(index + 1) % count];

  if (region === undefined || previous === undefined || next === undefined) {
    throw new RangeError("tour region is missing");
  }

  const road = moved(region);
  const entry = vertexFacing(road.centerline, headingTo(previous.offset, region.offset));
  const exit = vertexFacing(road.centerline, headingTo(region.offset, next.offset));

  if (entry === exit) {
    throw new RangeError(`region ${region.id} enters and leaves at the same vertex`);
  }

  return { region, road, center: region.offset, entry, exit };
}

function laps(placed: PlacedRegion, from: number, to: number): number {
  return to > from ? to : to + placed.road.centerline.length - 1;
}

function node(id: string, piece: RoadPiece, end: "start" | "end"): WorldNode {
  const point = end === "start" ? piece.centerline[0] : piece.centerline.at(-1);
  const sample = end === "start" ? piece.profileSamples[0] : piece.profileSamples.at(-1);

  return { id, x: point?.x ?? 0, z: point?.z ?? 0, elevationM: sample?.elevationM ?? 0 };
}

function edge(id: string, regionId: string, from: string, to: string, piece: RoadPiece): RoadEdge {
  return { id, regionId, fromNodeId: from, toNodeId: to, ...piece };
}

/** Grade of a piece along its travel direction at its first or last chord. */
function pieceSlope(piece: RoadPiece, end: "start" | "end"): number {
  const samples =
    end === "start" ? piece.profileSamples.slice(0, 2) : piece.profileSamples.slice(-2);

  const [from, to] = samples;

  return from === undefined || to === undefined
    ? 0
    : (to.elevationM - from.elevationM) / (to.distanceM - from.distanceM);
}

function roadEnd(
  placed: PlacedRegion,
  vertex: number,
  piece: RoadPiece,
  end: "start" | "end",
  matchGrade: boolean,
): RoadEnd {
  const point = end === "start" ? piece.centerline[0] : piece.centerline.at(-1);
  const sample = end === "start" ? piece.profileSamples[0] : piece.profileSamples.at(-1);

  return {
    point: point ?? { x: 0, z: 0 },
    headingRad: chordHeadingRad(placed.road.centerline, vertex),
    elevationM: sample?.elevationM ?? 0,
    slope: matchGrade ? pieceSlope(piece, end) : undefined,
  };
}

interface RegionPieces {
  readonly through: RoadPiece;
  readonly around: RoadPiece;
}

function regionPieces(placed: PlacedRegion): RegionPieces {
  return {
    through: cutPiece(placed.road, placed.entry, laps(placed, placed.entry, placed.exit)),
    around: cutPiece(placed.road, placed.exit, laps(placed, placed.exit, placed.entry)),
  };
}

/** Splits a transition at its middle vertex: the first half belongs to the region it leaves. */
function halves(piece: RoadPiece): readonly [RoadPiece, RoadPiece] {
  const middle = Math.floor((piece.centerline.length - 1) / 2);
  const road: SourceRoad = { ...piece, closed: false };

  return [cutPiece(road, 0, middle), cutPiece(road, middle, piece.centerline.length - 1)];
}

/** What one region adds to the world: its junctions, roads, tour steps and own loop. */
interface RegionShare {
  readonly nodes: readonly WorldNode[];
  readonly edges: readonly RoadEdge[];
  readonly tour: readonly PathStep[];
  readonly loop: WorldPath;
}

function forward(edgeId: string): PathStep {
  return { edgeId, direction: "forward" };
}

/** The region's two loop halves and the transition to the next region, split at its border. */
function regionEdges(
  here: PlacedRegion,
  next: PlacedRegion,
  chordM: number,
  matchGrade: boolean,
): readonly RoadEdge[] {
  const id = here.region.id;
  const nextId = next.region.id;
  const pieces = regionPieces(here);
  const border = `${id}-${nextId}`;

  const [out, inbound] = halves(
    transitionRoad(
      roadEnd(here, here.exit, pieces.through, "end", matchGrade),
      roadEnd(next, next.entry, regionPieces(next).through, "start", matchGrade),
      chordM,
    ),
  );

  return [
    edge(`${id}:through`, id, `${id}:entry`, `${id}:exit`, pieces.through),
    edge(`${id}:around`, id, `${id}:exit`, `${id}:entry`, pieces.around),
    edge(`${border}:out`, id, `${id}:exit`, `${border}:border`, out),
    edge(`${border}:in`, nextId, `${border}:border`, `${nextId}:entry`, inbound),
  ];
}

/** The loop's segments as distances from the region's entry vertex, where its path starts. */
function segmentsFromEntry(placed: PlacedRegion): readonly SegmentDef[] {
  const lengths = cumulativeLengths(placed.road.centerline);
  const lapM = lengths.at(-1) ?? 0;
  const entryM = lengths[placed.entry] ?? 0;

  return placed.region.loop.segments.map((segment) => {
    const startM = (segment.startM - entryM + lapM) % lapM;
    const endM = startM + segment.endM - segment.startM;

    if (endM > lapM) {
      throw new RangeError(`segment ${segment.id} of region ${placed.region.id} crosses its entry`);
    }

    return { ...segment, startM, endM };
  });
}

function regionShare(spec: TourWorldSpec, here: PlacedRegion, next: PlacedRegion): RegionShare {
  const id = here.region.id;
  const edges = regionEdges(here, next, spec.chordM, spec.matchGrades === true);
  const [through, around, out] = edges;

  if (through === undefined || around === undefined || out === undefined) {
    throw new RangeError(`region ${id} has no roads`);
  }

  return {
    nodes: [
      node(`${id}:entry`, through, "start"),
      node(`${id}:exit`, through, "end"),
      node(out.toNodeId, out, "end"),
    ],
    edges,
    tour: edges.flatMap((road) => (road === around ? [] : [forward(road.id)])),
    loop: {
      id: `${spec.id}-${id}`,
      name: here.region.pathName ?? here.region.name,
      loop: true,
      segments: here.region.keepSegments === true ? segmentsFromEntry(here) : [],
      steps: [forward(through.id), forward(around.id)],
    },
  };
}

/**
 * A world whose regions are joined into one tour (ADR-033 step 3). Each region keeps its own
 * loop as a path; the tour rides part of every loop and crosses to the next region on a smooth
 * transition road whose middle is the region border.
 */
export function regionTourWorld(spec: TourWorldSpec): WorldData {
  const placed = spec.regions.map((_, index) => place(spec.regions, index));

  const shares = placed.map((here, index) =>
    regionShare(spec, here, placed[(index + 1) % placed.length] ?? here),
  );

  return {
    id: spec.id,
    name: spec.name,
    revision: spec.revision,
    regions: spec.regions.map(({ id, name, scenery }) => ({ id, name, scenery })),
    nodes: shares.flatMap((share) => share.nodes),
    edges: shares.flatMap((share) => share.edges),
    paths: [
      {
        id: spec.tourId,
        name: spec.tourName,
        loop: true,
        segments: [],
        steps: shares.flatMap((share) => share.tour),
      },
      ...shares.map((share) => share.loop),
    ],
  };
}
