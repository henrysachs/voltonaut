import * as THREE from "three";

import type { BikeGeometry, Point3 } from "./bikeGeometry.js";
import { addSweep, tubeProfile } from "./bikeFrame.js";
import type { PartBucket } from "./bikeMaterials.js";
import { alignY, placed, roundedBox } from "./bikeMesh.js";
import {
  add3,
  ellipseSection,
  lerp,
  mix,
  smoothPath,
  taperedTube,
  UP,
  withZ,
  type Point2,
} from "./bikeSweep.js";

const THIN_ROD = (): Point2[] => ellipseSection(8, 0.0035, 0.0035);

function addHeadsetAndStem(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const axis = g.steeringAxis;
  const at = (base: Point3, along: number): Point3 => add3(base, axis, along);

  bucket.add(
    "carbon",
    taperedTube(at(g.headTubeTop, 0.002), at(g.headTubeTop, 0.012), 0.022, 0.0185, 20),
  );
  bucket.add(
    "carbon",
    taperedTube(at(g.headTubeTop, 0.012), at(g.steererTop, -0.04), 0.0178, 0.0178, 18),
  );
  bucket.add(
    "carbon",
    taperedTube(at(g.steererTop, -0.042), at(g.steererTop, 0.002), 0.0205, 0.0195, 18),
  );
  bucket.add(
    "alloy",
    taperedTube(at(g.steererTop, 0.002), at(g.steererTop, 0.006), 0.016, 0.014, 16),
  );
  addSweep(
    bucket,
    "carbon",
    smoothPath([at(g.steererTop, -0.02), g.barClamp], 8),
    (t) => ellipseSection(14, lerp(0.0175, 0.0155, t), lerp(0.021, 0.018, t)),
    UP,
  );
  bucket.add(
    "carbon",
    taperedTube(withZ(g.barClamp, -0.026), withZ(g.barClamp, 0.026), 0.021, 0.021, 18),
  );
}

/** Compact drop bar: tops, forward bend under the hoods, drop and flat ends (right half, +Z). */
function dropBarHalf(halfWidthM: number): Point3[] {
  const w = halfWidthM;

  return [
    [0, 0, 0.11],
    [0.003, 0, 0.165],
    [0.022, 0, 0.198],
    [0.055, -0.002, w - 0.002],
    [0.082, -0.012, w],
    [0.095, -0.04, w],
    [0.09, -0.085, w + 0.004],
    [0.068, -0.118, w + 0.008],
    [0.03, -0.13, w + 0.01],
    [-0.02, -0.133, w + 0.011],
  ];
}

/** Brake/shift hood on the bar bend plus lever blade and bar-end plug for one side. */
function addShifter(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>, side: 1 | -1): void {
  const clamp = g.barClamp;
  const w = g.barHalfWidthM;
  const at = (x: number, y: number, z = w): Point3 => [clamp[0] + x, clamp[1] + y, side * z];

  const hood = [
    at(0.044, 0.006),
    at(0.072, 0.014),
    at(0.1, 0.018),
    at(0.116, 0.03),
    at(0.122, 0.038),
  ];

  const lever = [
    at(0.112, 0.016),
    at(0.118, -0.012),
    at(0.116, -0.05),
    at(0.106, -0.088),
    at(0.09, -0.112),
  ];

  addSweep(
    bucket,
    "tape",
    smoothPath(hood, 14),
    (t) => ellipseSection(14, lerp(0.0145, 0.011, t), lerp(0.017, 0.012 - 0.004 * t, t)),
    UP,
  );
  addSweep(bucket, "carbon", smoothPath(lever, 14), (t) =>
    ellipseSection(10, lerp(0.0045, 0.0035, t), lerp(0.01, 0.007, t)),
  );
  bucket.add(
    "carbon",
    taperedTube(at(-0.02, -0.133, w + 0.011), at(-0.024, -0.133, w + 0.011), 0.0128, 0.0128, 12),
  );
}

function addHandlebar(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const clamp = g.barClamp;
  const half = dropBarHalf(g.barHalfWidthM);

  const local = [
    ...half.toReversed().map((p): Point3 => [p[0], p[1], -p[2]]),
    [0, 0, 0] as const,
    ...half,
  ];

  const curve = new THREE.CatmullRomCurve3(
    local.map((p) => new THREE.Vector3(p[0] + clamp[0], p[1] + clamp[1], p[2])),
    false,
    "centripetal",
  );

  bucket.add("tape", new THREE.TubeGeometry(curve, 60, 0.0122, 8, false));
  bucket.add("carbon", taperedTube(withZ(clamp, -0.11), withZ(clamp, 0.11), 0.0142, 0.0142, 16));

  addShifter(bucket, g, 1);
  addShifter(bucket, g, -1);
}

/** Front-to-back cross-section of the saddle: flat base, crowned top, soft edges. */
function saddleSection(t: number): Point2[] {
  const widen = Math.min(1, Math.max(0, (t - 0.28) / 0.55));
  const smooth = widen * widen * (3 - 2 * widen);
  const tailRound = t > 0.93 ? Math.sqrt(Math.max(0, 1 - ((t - 0.93) / 0.07) ** 2)) : 1;
  const noseRound = t < 0.05 ? 0.55 + 0.45 * (t / 0.05) : 1;
  const halfWidth = (0.017 + 0.054 * smooth) * Math.max(0.35, tailRound);
  const halfHeight = 0.014 * noseRound * Math.max(0.45, tailRound);

  return Array.from({ length: 20 }, (_, index): Point2 => {
    const angleRad = (index / 20) * Math.PI * 2;
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    const u = Math.sign(c) * Math.abs(c) ** 0.55 * halfWidth;
    const v = Math.sign(s) * Math.abs(s) ** 0.75 * halfHeight;

    return [u, v > 0 ? v * (1 - 0.35 * (u / halfWidth) ** 2) : v * 0.6];
  });
}

function addSaddle(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const top = g.saddleTop;
  const center = add3(top, [0, -0.014, 0]);
  const nose = add3(center, [0.15, 0.002, 0]);
  const tail = add3(center, [-0.12, 0.006, 0]);
  const shell = [nose, add3(center, [0.04, -0.004, 0]), add3(center, [-0.05, -0.002, 0]), tail];

  addSweep(bucket, "tape", smoothPath(shell, 28), saddleSection, UP);

  for (const side of [-1, 1] as const) {
    const rail = [
      add3(nose, [-0.03, -0.006, side * 0.008]),
      add3(center, [0.045, -0.03, side * 0.021]),
      add3(center, [-0.06, -0.03, side * 0.022]),
      add3(tail, [0.02, -0.008, side * 0.04]),
    ];

    addSweep(bucket, "alloy", smoothPath(rail, 16), THIN_ROD, UP);
  }

  const post = [add3(g.seatTubeTop, g.seatAxis, -0.02), add3(top, g.seatAxis, -0.04)];

  addSweep(bucket, "carbon", smoothPath(post, 8), tubeProfile(g.frame.tubes.seatpost, 16));
  bucket.add("carbon", roundedBox(0.05, 0.018, 0.034, 0.006), placed(add3(top, [0, -0.04, 0])));
}

const BOTTLE_PROFILE: readonly Point2[] = [
  [0.0001, 0],
  [0.03, 0],
  [0.036, 0.006],
  [0.037, 0.075],
  [0.033, 0.095],
  [0.035, 0.12],
  [0.037, 0.165],
  [0.031, 0.188],
  [0.016, 0.2],
  [0.012, 0.215],
  [0.007, 0.226],
  [0.0001, 0.228],
];

function addBottle(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const downFront = add3(g.headTubeBottom, g.steeringAxis, 0.04);

  const along = new THREE.Vector3(...downFront)
    .sub(new THREE.Vector3(...g.bottomBracket))
    .normalize();

  const axis: Point3 = [along.x, along.y, 0];
  const normal: Point3 = [-along.y, along.x, 0];
  const lift = Math.max(...g.frame.tubes.downTube.depthM) + 0.002;
  const base = add3(mix(g.bottomBracket, downFront, 0.22), normal, lift + 0.039);

  const at = (up: number, forward: number, z = 0): Point3 =>
    add3(add3(add3(base, normal, up), axis, forward), [0, 0, z]);

  const bottle = new THREE.LatheGeometry(
    BOTTLE_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)),
    20,
  );

  bucket.add("bottle", bottle, alignY(base, add3(base, axis, 0.23)));

  for (const side of [-1, 1] as const) {
    const cage = [
      at(-0.036, 0.02),
      at(-0.022, 0.06, side * 0.031),
      at(-0.02, 0.15, side * 0.031),
      at(-0.036, 0.17),
    ];

    addSweep(bucket, "carbon", smoothPath(cage, 14), THIN_ROD);
  }
}

/** Headset, stem, drop bar with hoods and levers, saddle with rails and post, bottle and cage. */
export function addCockpit(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  addHeadsetAndStem(bucket, g);
  addHandlebar(bucket, g);
  addSaddle(bucket, g);
  addBottle(bucket, g);
}
