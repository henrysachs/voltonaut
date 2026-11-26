import type { WorldPos } from "@voltonaut/engine";

export interface RoadSegment {
  readonly start: WorldPos;
  readonly end: WorldPos;
  readonly startM: number;
  readonly endM: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function onSegment(
  a: Readonly<WorldPos>,
  b: Readonly<WorldPos>,
  point: Readonly<WorldPos>,
): boolean {
  return (
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.z >= Math.min(a.z, b.z) &&
    point.z <= Math.max(a.z, b.z)
  );
}

function pointInTriangle(
  point: Readonly<WorldPos>,
  a: Readonly<WorldPos>,
  b: Readonly<WorldPos>,
  c: Readonly<WorldPos>,
): boolean {
  const area = cross(a.x, a.z, b.x, b.z, c.x, c.z);

  if (Math.abs(area) < 1e-9) return false;

  const ab = cross(a.x, a.z, b.x, b.z, point.x, point.z) * area;
  const bc = cross(b.x, b.z, c.x, c.z, point.x, point.z) * area;
  const ca = cross(c.x, c.z, a.x, a.z, point.x, point.z) * area;

  return ab >= 0 && bc >= 0 && ca >= 0;
}

function segmentsIntersect(
  a: Readonly<WorldPos>,
  b: Readonly<WorldPos>,
  c: Readonly<WorldPos>,
  d: Readonly<WorldPos>,
): boolean {
  const abc = cross(a.x, a.z, b.x, b.z, c.x, c.z);
  const abd = cross(a.x, a.z, b.x, b.z, d.x, d.z);
  const cda = cross(c.x, c.z, d.x, d.z, a.x, a.z);
  const cdb = cross(c.x, c.z, d.x, d.z, b.x, b.z);

  if (
    ((abc > 0 && abd < 0) || (abc < 0 && abd > 0)) &&
    ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0))
  ) {
    return true;
  }

  return (
    (Math.abs(abc) < 1e-9 && onSegment(a, b, c)) ||
    (Math.abs(abd) < 1e-9 && onSegment(a, b, d)) ||
    (Math.abs(cda) < 1e-9 && onSegment(c, d, a)) ||
    (Math.abs(cdb) < 1e-9 && onSegment(c, d, b))
  );
}

function pointSegmentDistanceSquared(
  point: Readonly<WorldPos>,
  start: Readonly<WorldPos>,
  end: Readonly<WorldPos>,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;

  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared),
        );

  return (point.x - start.x - fraction * dx) ** 2 + (point.z - start.z - fraction * dz) ** 2;
}

function segmentDistanceSquared(
  a: Readonly<WorldPos>,
  b: Readonly<WorldPos>,
  c: Readonly<WorldPos>,
  d: Readonly<WorldPos>,
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;

  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b),
  );
}

export function triangleRoadDistanceSquared(
  a: Readonly<WorldPos>,
  b: Readonly<WorldPos>,
  c: Readonly<WorldPos>,
  road: Readonly<RoadSegment>,
): number {
  if (pointInTriangle(road.start, a, b, c) || pointInTriangle(road.end, a, b, c)) return 0;

  return Math.min(
    segmentDistanceSquared(a, b, road.start, road.end),
    segmentDistanceSquared(b, c, road.start, road.end),
    segmentDistanceSquared(c, a, road.start, road.end),
  );
}
