import type { EngineRoute, WorldPos } from "@voltonaut/engine";
import * as THREE from "three";

import { triangleRoadDistanceSquared, type RoadSegment } from "./terrainRoadMath.js";

const FOREIGN_ROAD_CLEARANCE_M = 8;

/** Mitered inside corners overlap; the apron stays below the higher neighbor. */
const ROAD_APRON_DROP_M = 0.3;
const ROAD_INDEX_CELL_M = 100;
const LOCAL_DIRECTION_RAD = 0.05;
const DISTANCE_EPSILON_M = 1e-6;

export type ForeignRoadQuery = (
  a: Readonly<WorldPos>,
  b: Readonly<WorldPos>,
  c: Readonly<WorldPos>,
  fromM: number,
  toM: number,
  roadShoulder: boolean,
) => boolean;

interface RoadBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function roadCellKey(x: number, z: number): string {
  return `${Math.floor(x / ROAD_INDEX_CELL_M)},${Math.floor(z / ROAD_INDEX_CELL_M)}`;
}

function roadSegments(route: Readonly<EngineRoute>): readonly RoadSegment[] {
  const segmentCount = Math.max(1, Math.ceil(route.lengthM / 10));
  const stepM = route.lengthM / segmentCount;
  const points: WorldPos[] = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    points.push(route.worldPos(index * stepM));
  }

  const segments: RoadSegment[] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    if (start === undefined || end === undefined) {
      throw new RangeError("road index point is missing");
    }

    segments.push({
      start,
      end,
      startM: index * stepM,
      endM: (index + 1) * stepM,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minZ: Math.min(start.z, end.z),
      maxZ: Math.max(start.z, end.z),
    });
  }

  return segments;
}

function indexRoadSegments(
  segments: readonly RoadSegment[],
): ReadonlyMap<string, readonly number[]> {
  const cells = new Map<string, number[]>();

  for (const [index, segment] of segments.entries()) {
    const minCellX = Math.floor((segment.minX - FOREIGN_ROAD_CLEARANCE_M) / ROAD_INDEX_CELL_M);

    const maxCellX = Math.floor((segment.maxX + FOREIGN_ROAD_CLEARANCE_M) / ROAD_INDEX_CELL_M);

    const minCellZ = Math.floor((segment.minZ - FOREIGN_ROAD_CLEARANCE_M) / ROAD_INDEX_CELL_M);

    const maxCellZ = Math.floor((segment.maxZ + FOREIGN_ROAD_CLEARANCE_M) / ROAD_INDEX_CELL_M);

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const key = roadCellKey(cellX * ROAD_INDEX_CELL_M, cellZ * ROAD_INDEX_CELL_M);
        const cell = cells.get(key);

        if (cell === undefined) {
          cells.set(key, [index]);
        } else {
          cell.push(index);
        }
      }
    }
  }

  return cells;
}

function candidateRoadIndices(
  cells: Pick<ReadonlyMap<string, readonly number[]>, "get">,
  bounds: Readonly<RoadBounds>,
): ReadonlySet<number> {
  const candidates = new Set<number>();

  for (
    let cellX = Math.floor(bounds.minX / ROAD_INDEX_CELL_M);
    cellX <= Math.floor(bounds.maxX / ROAD_INDEX_CELL_M);
    cellX += 1
  ) {
    for (
      let cellZ = Math.floor(bounds.minZ / ROAD_INDEX_CELL_M);
      cellZ <= Math.floor(bounds.maxZ / ROAD_INDEX_CELL_M);
      cellZ += 1
    ) {
      const key = roadCellKey(cellX * ROAD_INDEX_CELL_M, cellZ * ROAD_INDEX_CELL_M);

      for (const index of cells.get(key) ?? []) candidates.add(index);
    }
  }

  return candidates;
}

function isLocalRoadSegment(
  road: Readonly<RoadSegment>,
  fromM: number,
  toM: number,
  routeLengthM: number,
  loop: boolean,
  ownHeadingRad: number,
): boolean {
  if (road.endM > fromM + DISTANCE_EPSILON_M && road.startM < toM - DISTANCE_EPSILON_M) {
    return true;
  }

  const touches =
    Math.abs(road.endM - fromM) <= DISTANCE_EPSILON_M ||
    Math.abs(road.startM - toM) <= DISTANCE_EPSILON_M ||
    (loop &&
      ((fromM <= DISTANCE_EPSILON_M && road.endM >= routeLengthM - DISTANCE_EPSILON_M) ||
        (toM >= routeLengthM - DISTANCE_EPSILON_M && road.startM <= DISTANCE_EPSILON_M)));

  if (!touches) return false;

  const roadHeadingRad = Math.atan2(road.end.z - road.start.z, road.end.x - road.start.x);

  const headingGapRad = Math.abs(
    Math.atan2(Math.sin(roadHeadingRad - ownHeadingRad), Math.cos(roadHeadingRad - ownHeadingRad)),
  );

  return headingGapRad <= LOCAL_DIRECTION_RAD;
}

/** Spatial road index used to reject alpine terrain faces that cover a foreign leg. */
export function createForeignRoadQuery(route: Readonly<EngineRoute>): ForeignRoadQuery {
  const segments = roadSegments(route);
  const cells = indexRoadSegments(segments);

  return (a, b, c, fromM, toM, roadShoulder) => {
    if (roadShoulder) return false;

    const ownHeadingRad = route.headingRad((fromM + toM) / 2);

    const candidates = candidateRoadIndices(cells, {
      minX: Math.min(a.x, b.x, c.x) - FOREIGN_ROAD_CLEARANCE_M,
      maxX: Math.max(a.x, b.x, c.x) + FOREIGN_ROAD_CLEARANCE_M,
      minZ: Math.min(a.z, b.z, c.z) - FOREIGN_ROAD_CLEARANCE_M,
      maxZ: Math.max(a.z, b.z, c.z) + FOREIGN_ROAD_CLEARANCE_M,
    });

    for (const index of candidates) {
      const road = segments[index];

      if (
        road !== undefined &&
        !isLocalRoadSegment(road, fromM, toM, route.lengthM, route.loop, ownHeadingRad) &&
        triangleRoadDistanceSquared(a, b, c, road) <= FOREIGN_ROAD_CLEARANCE_M ** 2
      ) {
        return true;
      }
    }

    return false;
  };
}

function apronOffsetNormal(
  route: Readonly<EngineRoute>,
  index: number,
  count: number,
  stepM: number,
): WorldPos {
  const distanceM = index * stepM;

  const beforeM =
    index === 0 ? (route.loop ? route.lengthM - stepM / 2 : stepM / 2) : distanceM - stepM / 2;

  const afterM =
    index === count ? (route.loop ? stepM / 2 : route.lengthM - stepM / 2) : distanceM + stepM / 2;

  const beforeHeadingRad = route.headingRad(beforeM);
  const afterHeadingRad = route.headingRad(afterM);
  const beforeNormalX = -Math.sin(beforeHeadingRad);
  const beforeNormalZ = Math.cos(beforeHeadingRad);
  const afterNormalX = -Math.sin(afterHeadingRad);
  const afterNormalZ = Math.cos(afterHeadingRad);
  const normalX = beforeNormalX + afterNormalX;
  const normalZ = beforeNormalZ + afterNormalZ;
  const denominator = normalX * afterNormalX + normalZ * afterNormalZ;

  return {
    x: denominator === 0 ? afterNormalX : normalX / denominator,
    y: 0,
    z: denominator === 0 ? afterNormalZ : normalZ / denominator,
  };
}

/** Narrow mitered strip that keeps both asphalt shoulders supported through alpine corners. */
export function createRoadApronGeometry(
  route: Readonly<EngineRoute>,
  groundColor: number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const count = Math.ceil(route.lengthM / 2);
  const stepM = route.lengthM / count;
  const color = new THREE.Color(groundColor);

  for (let index = 0; index <= count; index += 1) {
    const normal = apronOffsetNormal(route, index, count, stepM);
    const position = route.worldPos(index * stepM);

    for (const lateralM of [-4, 4]) {
      vertices.push(
        position.x + normal.x * lateralM,
        position.y - ROAD_APRON_DROP_M,
        position.z + normal.z * lateralM,
      );
      colors.push(color.r, color.g, color.b);
    }

    if (index === 0) continue;

    const base = index * 2;

    indices.push(base - 2, base - 1, base, base, base - 1, base + 1);
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}
