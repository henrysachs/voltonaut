import * as THREE from "three";

import { CASSETTE_TEETH, cogZ, pitchRadiusM } from "./bikeDrivetrain.js";
import type { BikeGeometry, Point3 } from "./bikeGeometry.js";
import { PartBucket, type BikeMaterials } from "./bikeMaterials.js";
import { alignY, latheZ, placed, roundedBox, toothedRing } from "./bikeMesh.js";
import { lerp, taperedTube, type Point2 } from "./bikeSweep.js";

const WHEEL_SEGMENTS = 64;
const SIDEWALL_STEPS = 3;

interface WheelPlan {
  readonly g: Readonly<BikeGeometry>;
  readonly front: boolean;
  readonly rimOuter: number;
  readonly rimInner: number;
  readonly rimHalf: number;
  readonly dropoutZ: number;
  readonly driveFlangeZ: number;
}

function addTire(bucket: Readonly<PartBucket>, plan: Readonly<WheelPlan>): void {
  const { g, rimOuter, rimHalf } = plan;
  const tireHalf = g.tireWidthM / 2;
  const tireCenter = g.wheelRadiusM - tireHalf;
  const bead = rimOuter - 0.001;

  const crown = Array.from({ length: 13 }, (_, step): Point2 => {
    const angleRad = lerp(-1.95, 1.95, step / 12);

    return [tireCenter + Math.cos(angleRad) * tireHalf, Math.sin(angleRad) * tireHalf];
  });

  bucket.add(
    "rubber",
    latheZ(
      [
        [bead, -rimHalf * 0.82],
        ...crown.slice(SIDEWALL_STEPS, -SIDEWALL_STEPS),
        [bead, rimHalf * 0.82],
      ],
      WHEEL_SEGMENTS,
    ),
  );
  bucket.add(
    "sidewall",
    latheZ([[bead, -rimHalf * 0.85], ...crown.slice(0, SIDEWALL_STEPS + 1)], WHEEL_SEGMENTS),
  );
  bucket.add(
    "sidewall",
    latheZ([...crown.slice(-SIDEWALL_STEPS - 1), [bead, rimHalf * 0.85]], WHEEL_SEGMENTS),
  );
}

/** Rim cross-section (counter-clockwise in radius/z so the lathe faces outwards). */
function rimProfile(plan: Readonly<WheelPlan>, disc: boolean): Point2[] {
  const { rimOuter, rimInner, rimHalf, g } = plan;

  const edge: Point2[] = [
    [rimOuter - 0.004, -rimHalf],
    [rimOuter, -rimHalf + 0.0015],
    [rimOuter, rimHalf - 0.0015],
    [rimOuter - 0.004, rimHalf],
  ];

  if (disc) {
    return [
      [0.03, 0],
      [0.032, -0.018],
      [rimInner + 0.02, -rimHalf - 0.004],
      ...edge,
      [rimInner + 0.02, rimHalf + 0.004],
      [0.032, 0.018],
      [0.03, 0],
    ];
  }

  const shoulder = rimInner + g.rimDepthM * 0.35;

  return [
    [rimInner, 0],
    [rimInner + 0.003, -rimHalf * 0.55],
    [shoulder, -rimHalf * 0.96],
    ...edge,
    [shoulder, rimHalf * 0.96],
    [rimInner + 0.003, rimHalf * 0.55],
    [rimInner, 0],
  ];
}

function addHub(bucket: Readonly<PartBucket>, plan: Readonly<WheelPlan>): void {
  const { dropoutZ, driveFlangeZ } = plan;

  const hub: Point2[] = [
    [0.0105, -dropoutZ],
    [0.016, -dropoutZ + 0.004],
    [0.016, -0.04],
    [0.024, -0.038],
    [0.024, -0.033],
    [0.014, -0.028],
    [0.0125, 0],
    [0.014, driveFlangeZ - 0.005],
    [0.024, driveFlangeZ],
    [0.024, driveFlangeZ + 0.005],
    [0.016, driveFlangeZ + 0.007],
    [plan.front ? 0.016 : 0.017, dropoutZ - 0.004],
    [0.0105, dropoutZ],
  ];

  bucket.add("carbon", latheZ(hub, 20));
  bucket.add(
    "alloy",
    taperedTube([0, 0, -dropoutZ - 0.004], [0, 0, dropoutZ + 0.004], 0.0072, 0.0072, 12),
  );
}

/** Two-cross bladed spokes alternating between both hub flanges. */
function addSpokes(bucket: Readonly<PartBucket>, plan: Readonly<WheelPlan>): void {
  const spokes = plan.g.wheel.spokeCount;
  const spokeEnd = plan.rimInner + 0.002;

  for (let spoke = 0; spoke < spokes; spoke += 1) {
    const rimRad = (spoke / spokes) * Math.PI * 2;
    const side = spoke % 2 === 0 ? 1 : -1;
    const leading = Math.floor(spoke / 2) % 2 === 0 ? 1 : -1;
    const hubRad = rimRad + leading * ((8 * Math.PI) / spokes);
    const flangeZ = side === 1 ? plan.driveFlangeZ + 0.0025 : -0.0355;
    const start: Point3 = [Math.cos(hubRad) * 0.021, Math.sin(hubRad) * 0.021, flangeZ];
    const end: Point3 = [Math.cos(rimRad) * spokeEnd, Math.sin(rimRad) * spokeEnd, side * 0.0035];
    const lengthM = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const blade = new THREE.BoxGeometry(0.0021, lengthM, 0.0009);

    blade.translate(0, lengthM / 2, 0);
    bucket.add("carbon", blade, alignY(start, end));
  }
}

function addRotor(bucket: Readonly<PartBucket>, front: boolean): void {
  const radiusM = front ? 0.08 : 0.07;
  const z = front ? -0.05 : -0.057;

  const holes = Array.from({ length: 12 }, (_, index) => {
    const angleRad = (index / 12) * Math.PI * 2;

    return {
      x: Math.cos(angleRad) * (radiusM - 0.0075),
      y: Math.sin(angleRad) * (radiusM - 0.0075),
      radiusM: 0.0024,
    };
  });

  bucket.add("alloy", toothedRing(0, radiusM, radiusM - 0.016, 0.0018, holes), placed([0, 0, z]));

  for (let arm = 0; arm < 6; arm += 1) {
    const angleRad = (arm / 6) * Math.PI * 2 + 0.3;
    const reach = (radiusM - 0.01) / 2 + 0.008;

    bucket.add(
      "drivetrain",
      roundedBox(radiusM - 0.03, 0.008, 0.0022, 0.003),
      placed([Math.cos(angleRad) * reach, Math.sin(angleRad) * reach, z], [0, 0, angleRad + 0.35]),
    );
  }
}

/** Stepped 11-speed cassette as one lathe plus a toothed outer cog. */
function addCassette(bucket: Readonly<PartBucket>): void {
  const steps: Point2[] = [[0.017, 0.064]];

  for (const [index, teeth] of CASSETTE_TEETH.entries()) {
    const radiusM = pitchRadiusM(teeth) + 0.0024;
    const z = cogZ(index);

    steps.push([radiusM, z + 0.001], [radiusM, z - 0.001], [radiusM - 0.006, z - 0.0012]);
  }

  steps.push([0.017, 0.022]);
  bucket.add("drivetrain", latheZ(steps.toReversed(), 30));
  bucket.add(
    "drivetrain",
    toothedRing(11, pitchRadiusM(11) + 0.0028, 0.012, 0.0019),
    placed([0, 0, cogZ(0)]),
  );
}

/** One wheel group with its origin on the axle; it spins about local Z. */
export function buildWheel(
  g: Readonly<BikeGeometry>,
  materials: BikeMaterials,
  front: boolean,
): THREE.Group {
  const bucket = new PartBucket();
  const group = new THREE.Group();
  const disc = !front && g.wheel.rearDisc;

  const plan: WheelPlan = {
    g,
    front,
    rimOuter: g.rimRadiusM + 0.0015,
    rimInner: g.rimRadiusM - g.rimDepthM,
    rimHalf: Math.max(g.wheel.rimHalfWidthM, g.tireWidthM * 0.34),
    dropoutZ: front ? 0.05 : 0.066,
    driveFlangeZ: front ? 0.034 : 0.021,
  };

  addTire(bucket, plan);
  bucket.add("rim", latheZ(rimProfile(plan, disc), WHEEL_SEGMENTS));
  bucket.add(
    "alloy",
    taperedTube([plan.rimInner + 0.004, 0, 0], [plan.rimInner - 0.012, 0, 0], 0.0028, 0.0024, 8),
  );
  addHub(bucket, plan);

  if (!disc) addSpokes(bucket, plan);

  addRotor(bucket, front);

  if (!front) addCassette(bucket);

  group.name = front ? "wheel_front" : "wheel_rear";
  group.position.set(...(front ? g.frontAxle : g.rearAxle));
  bucket.build(group, materials, group.name);

  return group;
}
