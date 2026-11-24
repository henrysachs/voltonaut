import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { vector, type Point2 } from "./bikeSweep.js";

/** Revolves a (radius, z) profile around the Z axis (the wheel axle). */
export function latheZ(profile: readonly Point2[], segments: number): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(
    profile.map(([radius, z]) => new THREE.Vector2(radius, z)),
    segments,
  );

  geometry.rotateX(Math.PI / 2);

  return geometry;
}

function circlePoints(cx: number, cy: number, radius: number, segments: number): THREE.Vector2[] {
  return Array.from({ length: segments }, (_, index) => {
    const angleRad = (-index / segments) * Math.PI * 2;

    return new THREE.Vector2(cx + Math.cos(angleRad) * radius, cy + Math.sin(angleRad) * radius);
  });
}

export interface RingHole {
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
}

const TOOTH_STEPS = [
  [0, -1],
  [0.18, -1],
  [0.4, 0],
  [0.6, 0],
  [0.82, -1],
] as const;

/** Counter-clockwise outline of a sprocket with simplified tooth flanks. */
function toothOutline(teeth: number, outerRadiusM: number): THREE.Vector2[] {
  const toothDepthM = 0.0045;
  const pitchRad = (Math.PI * 2) / teeth;

  return Array.from({ length: teeth }, (_, tooth) =>
    TOOTH_STEPS.map(([fraction, depth]) => {
      const angleRad = tooth * pitchRad + pitchRad * fraction;
      const radius = outerRadiusM + depth * toothDepthM;

      return new THREE.Vector2(Math.cos(angleRad) * radius, Math.sin(angleRad) * radius);
    }),
  ).flat();
}

/** Flat ring in the XY plane centred on z = 0; teeth = 0 gives a plain ring. */
export function toothedRing(
  teeth: number,
  outerRadiusM: number,
  innerRadiusM: number,
  depthM: number,
  holes: readonly RingHole[] = [],
): THREE.BufferGeometry {
  const outline =
    teeth > 0
      ? toothOutline(teeth, outerRadiusM)
      : circlePoints(0, 0, outerRadiusM, 48).toReversed();

  const face = new THREE.Shape(outline);

  if (innerRadiusM > 0) face.holes.push(new THREE.Path(circlePoints(0, 0, innerRadiusM, 32)));

  for (const hole of holes) {
    face.holes.push(new THREE.Path(circlePoints(hole.x, hole.y, hole.radiusM, 6)));
  }

  const geometry = new THREE.ExtrudeGeometry(face, { depth: depthM, bevelEnabled: false });

  geometry.translate(0, 0, -depthM / 2);

  return geometry;
}

/** Extrudes a closed XY outline along Z with a soft bevel, centred on z = 0. */
export function extrudedOutline(
  outline: readonly Point2[],
  depthM: number,
  bevelM: number,
): THREE.BufferGeometry {
  const face = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const coreM = Math.max(0.0005, depthM - bevelM * 2);

  const geometry = new THREE.ExtrudeGeometry(face, {
    depth: coreM,
    bevelEnabled: bevelM > 0,
    bevelThickness: bevelM,
    bevelSize: bevelM,
    bevelSegments: 1,
    curveSegments: 2,
  });

  geometry.translate(0, 0, -coreM / 2);

  return geometry;
}

const CORNERS = [
  [1, 1, 0],
  [-1, 1, 0.5],
  [-1, -1, 1],
  [1, -1, 1.5],
] as const;

/** Rounded rectangle outline centred on the origin. */
export function roundedRect(widthM: number, heightM: number, radiusM: number): Point2[] {
  const halfW = widthM / 2 - radiusM;
  const halfH = heightM / 2 - radiusM;

  return CORNERS.flatMap(([sx, sy, start]) =>
    [0, 1, 2].map((step): Point2 => {
      const angleRad = (start + step / 4) * Math.PI;

      return [sx * halfW + Math.cos(angleRad) * radiusM, sy * halfH + Math.sin(angleRad) * radiusM];
    }),
  );
}

/** Rounded box: rounded rectangle in XY extruded along Z. */
export function roundedBox(
  widthM: number,
  heightM: number,
  depthM: number,
  radiusM: number,
): THREE.BufferGeometry {
  return extrudedOutline(
    roundedRect(widthM, heightM, Math.min(radiusM, widthM / 2, heightM / 2) * 0.999),
    depthM,
    Math.min(radiusM, depthM / 2) * 0.6,
  );
}

function halfCircle(cx: number, radius: number, fromRad: number): Point2[] {
  return Array.from({ length: 9 }, (_, step): Point2 => {
    const angleRad = fromRad + (step / 8) * Math.PI;

    return [cx + Math.cos(angleRad) * radius, Math.sin(angleRad) * radius];
  });
}

/** Stadium outline from the origin along +X with different end radii. */
export function stadiumOutline(
  lengthM: number,
  startRadiusM: number,
  endRadiusM: number,
): Point2[] {
  return [
    ...halfCircle(0, startRadiusM, Math.PI / 2),
    ...halfCircle(lengthM, endRadiusM, -Math.PI / 2),
  ];
}

/** Places a geometry so that its local +Y axis runs from `start` towards `end`. */
export function alignY(start: Point3, end: Point3): THREE.Matrix4 {
  const direction = vector(end).sub(vector(start)).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

  return new THREE.Matrix4().compose(vector(start), rotation, new THREE.Vector3(1, 1, 1));
}

/** Translation plus Euler rotation (XYZ, radians). */
export function placed(position: Point3, rotation: Point3 = [0, 0, 0]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    vector(position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
    new THREE.Vector3(1, 1, 1),
  );
}

function copyAttribute(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Writes into the merged buffer owned by the caller.
  target: Float32Array,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Three buffer attributes are mutable library objects that are only read here.
  source: Readonly<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>,
  offset: number,
): void {
  for (let vertex = 0; vertex < source.count; vertex += 1) {
    target[(offset + vertex) * 3] = source.getX(vertex);
    target[(offset + vertex) * 3 + 1] = source.getY(vertex);
    target[(offset + vertex) * 3 + 2] = source.getZ(vertex);
  }
}

/** Merges geometries into one non-indexed position/normal buffer so a material costs one draw call. */
export function mergeGeometries(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The merge consumes and disposes the temporary Three geometries it is given.
  geometries: readonly THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const flat: THREE.BufferGeometry[] = [];

  for (const geometry of geometries)
    flat.push(geometry.index === null ? geometry : geometry.toNonIndexed());

  let vertexCount = 0;

  for (const geometry of flat) vertexCount += geometry.getAttribute("position").count;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let offset = 0;

  for (const geometry of flat) {
    if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();

    copyAttribute(positions, geometry.getAttribute("position"), offset);
    copyAttribute(normals, geometry.getAttribute("normal"), offset);
    offset += geometry.getAttribute("position").count;
    geometry.dispose();
  }

  for (const geometry of geometries) geometry.dispose();

  const merged = new THREE.BufferGeometry();

  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.computeBoundingSphere();

  return merged;
}
