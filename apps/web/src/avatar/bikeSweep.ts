import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";

export type Point2 = readonly [number, number];

/** A closed counter-clockwise cross-section in (lateral, forward) coordinates for t ∈ [0, 1]. */
export type SectionProfile = (t: number) => readonly Point2[];

export interface SweepOptions {
  /** Preferred lateral axis of the section; projected perpendicular to the path. */
  readonly lateral: Point3;
  /** The section's +forward side is turned towards this direction. */
  readonly forward: Point3;
  readonly caps: boolean;
}

export const LATERAL: Point3 = [0, 0, 1];
export const FORWARD: Point3 = [1, 0, 0];
export const UP: Point3 = [0, 1, 0];

export function vector(point: Point3): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

/** Linear interpolation helper for tapered sections. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function mix(a: Point3, b: Point3, t: number): Point3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function add3(a: Point3, b: Point3, scale = 1): Point3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

export function withZ(point: Point3, z: number): Point3 {
  return [point[0], point[1], z];
}

/** Samples a straight line or a smooth centripetal Catmull-Rom curve through the control points. */
export function smoothPath(points: readonly Point3[], samples: number): Point3[] {
  const [start, end] = points;

  if (points.length === 2 && start !== undefined && end !== undefined) {
    return Array.from({ length: samples + 1 }, (_, index) => mix(start, end, index / samples));
  }

  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => vector(point)),
    false,
    "centripetal",
  );

  const sampled: Point3[] = [];

  for (const point of curve.getSpacedPoints(samples)) sampled.push([point.x, point.y, point.z]);

  return sampled;
}

/** Ellipse with `halfLateral` across the bike and `halfForward` along the travel direction. */
export function ellipseSection(
  segments: number,
  halfLateral: number,
  halfForward: number,
): Point2[] {
  return Array.from({ length: segments }, (_, index): Point2 => {
    const angleRad = (index / segments) * Math.PI * 2;

    return [Math.cos(angleRad) * halfLateral, Math.sin(angleRad) * halfForward];
  });
}

/** Truncated airfoil (Kamm tail): round leading edge forward, narrowing tail behind. */
export function aeroSection(segments: number, halfLateral: number, halfForward: number): Point2[] {
  return Array.from({ length: segments }, (_, index): Point2 => {
    const angleRad = (index / segments) * Math.PI * 2;
    const forward = Math.sin(angleRad);
    const taper = forward < 0 ? 1 + 0.45 * forward : 1;
    const along = forward < 0 ? forward * 1.15 : forward;

    return [Math.cos(angleRad) * halfLateral * taper, along * halfForward];
  });
}

interface SectionFrame {
  readonly lateral: THREE.Vector3;
  readonly forward: THREE.Vector3;
}

function sectionFrame(
  path: readonly Point3[],
  index: number,
  options: Readonly<SweepOptions>,
): SectionFrame {
  const point = path[index] ?? [0, 0, 0];
  const previous = path[Math.max(0, index - 1)] ?? point;
  const next = path[Math.min(path.length - 1, index + 1)] ?? point;
  const tangent = vector(next).sub(vector(previous)).normalize();
  const hint = vector(options.lateral).normalize();
  const reference = Math.abs(tangent.dot(hint)) > 0.98 ? vector(UP) : hint;
  const lateral = reference.clone().addScaledVector(tangent, -reference.dot(tangent)).normalize();
  const forward = new THREE.Vector3().crossVectors(tangent, lateral);

  if (forward.dot(vector(options.forward)) < 0) {
    lateral.negate();
    forward.negate();
  }

  return { lateral, forward };
}

function tubeIndices(rings: number, ringSize: number): number[] {
  const indices: number[] = [];

  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let corner = 0; corner < ringSize; corner += 1) {
      const a = ring * ringSize + corner;
      const b = ring * ringSize + ((corner + 1) % ringSize);

      indices.push(a, b, a + ringSize, a + ringSize, b, b + ringSize);
    }
  }

  return indices;
}

interface CapMesh {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

/** Flat triangle-fan cap over one ring; vertices are duplicated for a crisp normal. */
function capMesh(ring: readonly number[], firstIndex: number, outward: boolean): CapMesh {
  const ringSize = ring.length / 3;
  const center = [0, 0, 0];
  const indices: number[] = [];

  for (const [index, value] of ring.entries())
    center[index % 3] = (center[index % 3] ?? 0) + value / ringSize;

  for (let corner = 0; corner < ringSize; corner += 1) {
    const a = firstIndex + 1 + corner;
    const b = firstIndex + 1 + ((corner + 1) % ringSize);

    indices.push(...(outward ? [firstIndex, a, b] : [firstIndex, b, a]));
  }

  return { positions: [...center, ...ring], indices };
}

/** Sweeps a varying cross-section along a sampled path into a smooth, optionally capped tube. */
export function sweepGeometry(
  path: readonly Point3[],
  profile: SectionProfile,
  options: Readonly<SweepOptions>,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const last = Math.max(1, path.length - 1);
  let ringSize = 0;

  for (const [index, point] of path.entries()) {
    const { lateral, forward } = sectionFrame(path, index, options);
    const section = profile(index / last);

    ringSize = section.length;

    for (const [u, v] of section) {
      const position = vector(point).addScaledVector(lateral, u).addScaledVector(forward, v);

      positions.push(position.x, position.y, position.z);
    }
  }

  const indices = tubeIndices(path.length, ringSize);

  if (options.caps) {
    const lastRing = (path.length - 1) * ringSize * 3;
    const start = capMesh(positions.slice(0, ringSize * 3), positions.length / 3, false);

    const end = capMesh(
      positions.slice(lastRing, lastRing + ringSize * 3),
      positions.length / 3 + ringSize + 1,
      true,
    );

    positions.push(...start.positions, ...end.positions);
    indices.push(...start.indices, ...end.indices);
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/** Round tube with a linear radius taper between two points. */
export function taperedTube(
  start: Point3,
  end: Point3,
  startRadiusM: number,
  endRadiusM: number,
  segments = 14,
): THREE.BufferGeometry {
  return sweepGeometry(
    [start, end],
    (t) => {
      const radiusM = lerp(startRadiusM, endRadiusM, t);

      return ellipseSection(segments, radiusM, radiusM);
    },
    { lateral: LATERAL, forward: FORWARD, caps: true },
  );
}
