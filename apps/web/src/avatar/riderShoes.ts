import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { extrudedOutline, placed } from "./bikeMesh.js";
import { lerp, type Point2 } from "./bikeSweep.js";
import type { LegPose, RiderJoints } from "./pose.js";
import { bonesOfSide } from "./riderRig.js";
import { type SkinBucket } from "./riderSkin.js";
import { roundedEnds, tube } from "./riderSurface.js";
import { rigid } from "./riderWeights.js";
import type { ShoeSpec } from "./riderSpecs.js";

/** Shoe space: origin at the cleat face, +X along the sole to the toe, +Y up, +Z outwards. */
const HEEL_X = -0.19;
const TOE_X = 0.088;
const CLEAT_M = 0.008;
const SOLE_M = 0.011;
const SOLE_TOP_M = CLEAT_M + SOLE_M;

/** Half width of the footprint at x: narrow heel, wide ball, rounded ends. */
function halfWidth(x: number): number {
  const t = (x - HEEL_X) / (TOE_X - HEEL_X);
  const ends = Math.sqrt(Math.max(0, 1 - Math.abs(2 * t - 1) ** 6));

  return (0.033 + 0.019 * Math.sin(Math.PI * Math.min(1, t * 1.25))) * ends;
}

/** Upper height above the sole along t (heel → toe): heel cup, instep, low toe box. */
function upperHeight(t: number): number {
  if (t < 0.38) return lerp(0.084, 0.08, t / 0.38);

  return lerp(0.08, 0.024, ((t - 0.38) / 0.62) ** 1.2);
}

function footprint(): Point2[] {
  const samples = 14;
  const side: Point2[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const x = lerp(HEEL_X, TOE_X, index / samples);

    side.push([x, Math.max(0.006, halfWidth(x))]);
  }

  return [...side, ...side.toReversed().map(([x, z]): Point2 => [x, -z])];
}

function shoeMatrix(leg: Readonly<LegPose>, side: 1 | -1): THREE.Matrix4 {
  const matrix = placed(leg.cleat, [0, 0, -leg.footPitchRad]);

  return side === 1 ? matrix : matrix.multiply(new THREE.Matrix4().makeScale(1, 1, -1));
}

/** Mirrors the winding after a negative scale so the left shoe faces outwards too. */
function rewound(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Flips the winding of the temporary geometry it owns.
  geometry: THREE.BufferGeometry,
  side: 1 | -1,
): THREE.BufferGeometry {
  if (side === 1) return geometry;

  const index = geometry.getIndex();

  if (index === null) {
    const position = geometry.getAttribute("position");

    for (let vertex = 0; vertex < position.count; vertex += 3) {
      const x = position.getX(vertex + 1);
      const y = position.getY(vertex + 1);
      const z = position.getZ(vertex + 1);

      position.setXYZ(
        vertex + 1,
        position.getX(vertex + 2),
        position.getY(vertex + 2),
        position.getZ(vertex + 2),
      );
      position.setXYZ(vertex + 2, x, y, z);
    }
  } else {
    for (let triangle = 0; triangle < index.count; triangle += 3) {
      const b = index.getX(triangle + 1);

      index.setX(triangle + 1, index.getX(triangle + 2));
      index.setX(triangle + 2, b);
    }
  }

  geometry.computeVertexNormals();

  return geometry;
}

/** Upper section at t (heel → toe): flat-bottomed and domed, the sides slightly hollowed. */
function upperSection(t: number, angleRad: number, scale = 1): readonly [number, number] {
  const x = lerp(HEEL_X, TOE_X, t);
  const round = roundedEnds(t, 0.03, 0.045, TOE_X - HEEL_X);
  const width = Math.max(0.004, halfWidth(x) * 0.98) * scale;
  const height = upperHeight(t) * scale * Math.max(0.25, round);
  const up = Math.sin(angleRad);

  return [Math.cos(angleRad) * width, up > 0 ? up ** 0.7 * height : up * 0.004];
}

interface ShoePart {
  readonly key: "shoe" | "dark";
  readonly geometry: THREE.BufferGeometry;
}

/** Sole and cleat in shoe space. */
function soleParts(): ShoePart[] {
  const cleat: Point2[] = [
    [-0.022, -0.026],
    [0.036, 0],
    [-0.022, 0.026],
  ];

  const flat: Point3 = [Math.PI / 2, 0, 0];

  return [
    {
      key: "dark",
      geometry: extrudedOutline(footprint(), SOLE_M, 0.003).applyMatrix4(
        placed([0, CLEAT_M + SOLE_M / 2, 0], flat),
      ),
    },
    {
      key: "dark",
      geometry: extrudedOutline(cleat, CLEAT_M, 0.0015).applyMatrix4(
        placed([0, CLEAT_M / 2, 0], flat),
      ),
    },
  ];
}

/** Closure dials on the outer side of the instep. */
function dialParts(spec: Readonly<ShoeSpec>): ShoePart[] {
  return Array.from({ length: spec.dials }, (_, dial): ShoePart => {
    const x = spec.dials === 1 ? -0.035 : lerp(-0.075, -0.01, dial);
    const t = (x - HEEL_X) / (TOE_X - HEEL_X);
    const position: Point3 = [x, SOLE_TOP_M + upperHeight(t) * 0.86, halfWidth(x) * 0.62];
    const knob = new THREE.CylinderGeometry(0.0115, 0.0135, 0.008, 18);

    return { key: "dark", geometry: knob.applyMatrix4(placed(position, [1, 0, 0])) };
  });
}

/** Every part of one road shoe in shoe space: sole, cleat, textured upper and dials. */
function shoeParts(spec: Readonly<ShoeSpec>): ShoePart[] {
  const path = Array.from({ length: 23 }, (_, index): Point3 => [
    lerp(HEEL_X, TOE_X, index / 22),
    SOLE_TOP_M - 0.003,
    0,
  ]);

  const upper = tube(path, upperSection, { lateral: [0, 0, 1], forward: [0, 1, 0], segments: 22 });

  return [...soleParts(), { key: "shoe", geometry: upper }, ...dialParts(spec)];
}

function addShoe(
  bucket: Readonly<SkinBucket>,
  leg: Readonly<LegPose>,
  side: 1 | -1,
  spec: Readonly<ShoeSpec>,
): void {
  const foot = rigid(bonesOfSide(side).foot);
  const matrix = shoeMatrix(leg, side);

  for (const { key, geometry } of shoeParts(spec)) {
    bucket.add(key, rewound(geometry.applyMatrix4(matrix), side), foot);
  }
}

export function addShoes(
  bucket: Readonly<SkinBucket>,
  joints: Readonly<RiderJoints>,
  spec: Readonly<ShoeSpec>,
): void {
  for (const [index, side] of ([1, -1] as const).entries()) {
    const leg = joints.legs[index];

    if (leg !== undefined) addShoe(bucket, leg, side, spec);
  }
}
