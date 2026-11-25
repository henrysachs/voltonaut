import * as THREE from "three";

import type { Point3 } from "./bikeGeometry.js";
import { lerp, vector } from "./bikeSweep.js";
import type { RiderJoints } from "./pose.js";
import {
  BIBS_START_S,
  COLLAR_S,
  inBand,
  JERSEY_HEM_S,
  KIT_ATLAS,
  pocketMask,
} from "./riderAtlas.js";
import type { BoneName, BoneSegments } from "./riderRig.js";
import { type SkinBucket } from "./riderSkin.js";
import { surfaceGeometry } from "./riderSurface.js";
import { envelope } from "./riderWeights.js";

const TAU = Math.PI * 2;

/**
 * Torso cross-section keys: (s, half width, half depth on the chest side, half depth on the back).
 * s = 0 is the pelvis, 1 the neck base; below 0 the bib shorts close over the saddle.
 */
const SECTION_KEYS: readonly (readonly [number, number, number, number])[] = [
  [-0.315, 0.02, 0.02, 0.02],
  [-0.29, 0.09, 0.07, 0.075],
  [-0.24, 0.145, 0.1, 0.108],
  [-0.15, 0.167, 0.112, 0.118],
  [-0.05, 0.166, 0.112, 0.114],
  [0.08, 0.157, 0.104, 0.108],
  [0.24, 0.146, 0.097, 0.104],
  [0.42, 0.152, 0.106, 0.108],
  [0.62, 0.168, 0.118, 0.112],
  [0.78, 0.184, 0.118, 0.108],
  [0.87, 0.192, 0.106, 0.1],
  [0.94, 0.176, 0.092, 0.094],
  [0.985, 0.122, 0.074, 0.078],
  [1.02, 0.072, 0.06, 0.062],
  [1.06, 0.064, 0.056, 0.058],
];

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Half width, chest half depth and back half depth of the torso at `s`. */
export function torsoSection(s: number): readonly [number, number, number] {
  let previous = SECTION_KEYS[0] ?? [0, 0, 0, 0];

  for (const key of SECTION_KEYS) {
    if (s <= key[0]) {
      const span = key[0] - previous[0];
      const t = span <= 0 ? 0 : smoothstep((s - previous[0]) / span);

      return [
        lerp(previous[1], key[1], t),
        lerp(previous[2], key[2], t),
        lerp(previous[3], key[3], t),
      ];
    }

    previous = key;
  }

  return [previous[1], previous[2], previous[3]];
}

/** Rounded-box section: flatter sides and back than an ellipse, like a real ribcage. */
function squared(value: number): number {
  return Math.sign(value) * Math.abs(value) ** 0.9;
}

/** Spine curve through the bind joints, extended straight below the pelvis and above the neck. */
export class TorsoSurface {
  private readonly curve: THREE.CatmullRomCurve3;
  readonly lengthM: number;

  constructor(joints: Readonly<RiderJoints>) {
    this.curve = new THREE.CatmullRomCurve3(
      joints.spine.map((point) => vector(point)),
      false,
      "centripetal",
    );
    this.lengthM = this.curve.getLength();
  }

  private centre(s: number): THREE.Vector3 {
    const clamped = Math.min(1, Math.max(0, s));
    const point = this.curve.getPointAt(clamped);

    return point.addScaledVector(this.curve.getTangentAt(clamped), (s - clamped) * this.lengthM);
  }

  /**
   * Surface point at spine position `s` and angle (0 = right side, π/2 = chest, 3π/2 = back);
   * `extraM` pushes it outwards, the jersey sits on the bibs and the pockets bulge.
   */
  point(s: number, angleRad: number, extraM = 0): Point3 {
    const [halfWidth, chest, back] = torsoSection(s);
    const tangent = this.curve.getTangentAt(Math.min(1, Math.max(0, s)));
    const front = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
    const sin = Math.sin(angleRad);
    const across = squared(Math.cos(angleRad)) * (halfWidth + extraM);
    const depth = squared(sin) * ((sin > 0 ? chest : back) + extraM);
    const point = this.centre(s).addScaledVector(front, depth);

    return [point.x, point.y, point.z + across];
  }
}

const TORSO_BONES: readonly BoneName[] = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "RightShoulder",
  "LeftShoulder",
  "RightUpLeg",
  "LeftUpLeg",
];

/** Hem and bibs follow the thighs only a little, so the cloth moves without flapping. */
const THIGH_BIAS = { RightUpLeg: 0.3, LeftUpLeg: 0.3 } as const;

/** Cloth thickness: the jersey sits on the bibs and gets a soft rolled hem. */
function clothOffsetM(s: number, angleRad: number): number {
  if (s < JERSEY_HEM_S) return 0;

  const hem = Math.max(0, 1 - (s - JERSEY_HEM_S) / 0.025);

  return 0.004 + 0.0025 * hem + 0.014 * pocketMask(s, angleRad);
}

/** Bibs and jersey as one smooth textured body; design, zip and seams are painted. */
export function addTorso(
  bucket: Readonly<SkinBucket>,
  joints: Readonly<RiderJoints>,
  bind: BoneSegments,
): void {
  const torso = new TorsoSurface(joints);

  bucket.add(
    "kit",
    surfaceGeometry(
      (u, v) => {
        const s = lerp(BIBS_START_S, COLLAR_S, v);
        const angle = u * TAU;

        return torso.point(s, angle, clothOffsetM(s, angle));
      },
      36,
      34,
      { wrapU: true, flip: true, uv: inBand(KIT_ATLAS.torso) },
    ),
    envelope(bind, TORSO_BONES, THIGH_BIAS),
  );
}
