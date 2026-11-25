import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import type { Point2 } from "./bikeSweep.js";

export interface SurfaceOptions {
  /** u wraps around (tubes, heads): the seam column is duplicated for UVs, its normals shared. */
  readonly wrapU: boolean;
  /** Reverse the winding when the parametrisation faces inwards. */
  readonly flip: boolean;
  /** Texture coordinates for (u, v); defaults to (u, v). */
  readonly uv: (u: number, v: number) => Point2;
}

const SURFACE_DEFAULTS: SurfaceOptions = { wrapU: false, flip: false, uv: (u, v) => [u, v] };

/** Averages the normals of the duplicated seam columns of a wrapped surface. */
function shareSeamNormals(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Writes the shared normals into the geometry it built.
  geometry: THREE.BufferGeometry,
  columns: number,
  rows: number,
): void {
  const normal = geometry.getAttribute("normal");
  const shared = new THREE.Vector3();

  for (let row = 0; row < rows; row += 1) {
    const first = row * columns;
    const last = first + columns - 1;

    shared
      .set(normal.getX(first), normal.getY(first), normal.getZ(first))
      .add(new THREE.Vector3(normal.getX(last), normal.getY(last), normal.getZ(last)))
      .normalize();
    normal.setXYZ(first, shared.x, shared.y, shared.z);
    normal.setXYZ(last, shared.x, shared.y, shared.z);
  }
}

/** Smooth parametric surface over u, v ∈ [0, 1] with texture coordinates. */
export function surfaceGeometry(
  point: (u: number, v: number) => Point3,
  uSegments: number,
  vSegments: number,
  options: Readonly<Partial<SurfaceOptions>> = {},
): THREE.BufferGeometry {
  const { wrapU, flip, uv } = { ...SURFACE_DEFAULTS, ...options };
  const columns = uSegments + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= vSegments; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u = column / uSegments;
      const v = row / vSegments;

      positions.push(...point(wrapU && column === uSegments ? 0 : u, v));
      uvs.push(...uv(u, v));
    }
  }

  for (let row = 0; row < vSegments; row += 1) {
    for (let column = 0; column < uSegments; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;

      indices.push(...(flip ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  if (wrapU) shareSeamNormals(geometry, columns, vSegments + 1);

  return geometry;
}

/** Point on a section ring: `angleRad` 0 = +lateral, π/2 = +forward. */
export type TubeSection = (t: number, angleRad: number) => Point2;

export interface TubeOptions {
  /** Preferred lateral axis of the section, projected perpendicular to the path. */
  readonly lateral: Point3;
  /** The section's +forward side is turned towards this direction. */
  readonly forward: Point3;
  readonly segments: number;
  readonly flip: boolean;
  readonly uv: (u: number, v: number) => Point2;
}

const TUBE_DEFAULTS: TubeOptions = {
  lateral: [0, 0, 1],
  forward: [1, 0, 0],
  segments: 16,
  flip: false,
  uv: (u, v) => [u, v],
};

interface Frame {
  readonly origin: THREE.Vector3;
  readonly lateral: THREE.Vector3;
  readonly forward: THREE.Vector3;
}

function tubeFrames(path: readonly Point3[], options: Readonly<TubeOptions>): Frame[] {
  return path.map((point, index) => {
    const previous = path[Math.max(0, index - 1)] ?? point;
    const next = path[Math.min(path.length - 1, index + 1)] ?? point;
    const tangent = new THREE.Vector3(...next).sub(new THREE.Vector3(...previous)).normalize();
    const hint = new THREE.Vector3(...options.lateral).normalize();
    const reference = Math.abs(tangent.dot(hint)) > 0.98 ? new THREE.Vector3(0, 1, 0) : hint;
    const lateral = reference.clone().addScaledVector(tangent, -reference.dot(tangent)).normalize();
    const forward = new THREE.Vector3().crossVectors(tangent, lateral);

    if (forward.dot(new THREE.Vector3(...options.forward)) < 0) {
      lateral.negate();
      forward.negate();
    }

    return { origin: new THREE.Vector3(...point), lateral, forward };
  });
}

/**
 * Smooth tube along a sampled path; the section is evaluated per ring (t along the path) and
 * angle. Ends are left open: sections should shrink to a point where an end is visible.
 */
export function tube(
  path: readonly Point3[],
  section: TubeSection,
  options: Readonly<Partial<TubeOptions>> = {},
): THREE.BufferGeometry {
  const resolved = { ...TUBE_DEFAULTS, ...options };
  const frames = tubeFrames(path, resolved);
  const last = Math.max(1, path.length - 1);

  return surfaceGeometry(
    (u, v) => {
      const index = Math.round(v * last);
      const frame = frames[index] ?? frames[0];
      const [across, along] = section(v, u * Math.PI * 2);

      if (frame === undefined) return [0, 0, 0];

      const point = frame.origin
        .clone()
        .addScaledVector(frame.lateral, across)
        .addScaledVector(frame.forward, along);

      return [point.x, point.y, point.z];
    },
    resolved.segments,
    last,
    { wrapU: true, flip: !resolved.flip, uv: resolved.uv },
  );
}

/** Ellipse ring with rounded closure towards the ends of [0, 1] (fingertips, shoe toes). */
export function roundedEnds(t: number, startM: number, endM: number, lengthM: number): number {
  const fromStart = (t * lengthM) / Math.max(1e-6, startM);
  const fromEnd = ((1 - t) * lengthM) / Math.max(1e-6, endM);
  const startScale = startM > 0 ? Math.sqrt(Math.max(0, 1 - Math.max(0, 1 - fromStart) ** 2)) : 1;
  const endScale = endM > 0 ? Math.sqrt(Math.max(0, 1 - Math.max(0, 1 - fromEnd) ** 2)) : 1;

  return Math.min(startScale, endScale);
}

/** Ellipsoid with texture coordinates; `segments` around Y and `rings` from bottom to top. */
export function ellipsoid(
  center: Point3,
  radii: Point3,
  segments = 16,
  rings = 10,
  uv?: (u: number, v: number) => Point2,
): THREE.BufferGeometry {
  return surfaceGeometry(
    (u, v) => {
      const azimuth = u * Math.PI * 2;
      const polar = Math.PI * (1 - v);

      return [
        center[0] + Math.sin(polar) * Math.cos(azimuth) * radii[0],
        center[1] + Math.cos(polar) * radii[1],
        center[2] + Math.sin(polar) * Math.sin(azimuth) * radii[2],
      ];
    },
    segments,
    rings,
    { wrapU: true, uv: uv ?? SURFACE_DEFAULTS.uv },
  );
}
