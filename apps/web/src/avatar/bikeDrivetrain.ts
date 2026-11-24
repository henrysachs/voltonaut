import * as THREE from "three";

import type { BikeGeometry, Point3 } from "./bikeGeometry.js";
import { PartBucket, type BikeMaterials } from "./bikeMaterials.js";
import { extrudedOutline, placed, roundedBox, stadiumOutline, toothedRing } from "./bikeMesh.js";
import { add3, lerp, mix, taperedTube, withZ, type Point2 } from "./bikeSweep.js";

export const CHAIN_PITCH_M = 0.0127;
export const CASSETTE_TEETH = [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30] as const;
const CHAIN_COG = 5;
const RING_TEETH = 50;
const PULLEY_RADIUS_M = 0.0235;

/** Pitch radius of a sprocket with `teeth` teeth. */
export function pitchRadiusM(teeth: number): number {
  return CHAIN_PITCH_M / (2 * Math.sin(Math.PI / teeth));
}

/** Cog plane on the rear hub; index 0 (11T) is outboard. */
export function cogZ(index: number): number {
  return 0.0625 - index * 0.0039;
}

function arcPoints(
  center: Point2,
  radius: number,
  fromRad: number,
  toRad: number,
  z: number,
): Point3[] {
  const steps = Math.max(2, Math.ceil((Math.abs(toRad - fromRad) * radius) / 0.004));

  return Array.from({ length: steps + 1 }, (_, step): Point3 => {
    const angleRad = lerp(fromRad, toRad, step / steps);

    return [center[0] + Math.cos(angleRad) * radius, center[1] + Math.sin(angleRad) * radius, z];
  });
}

/** Angle on the larger circle where the outer tangent towards the smaller one touches. */
function tangentRad(
  from: Point2,
  to: Point2,
  fromRadius: number,
  toRadius: number,
  upper: boolean,
): number {
  const baseRad = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const offset = Math.asin((toRadius - fromRadius) / Math.hypot(to[0] - from[0], to[1] - from[1]));

  return upper ? baseRad + Math.PI / 2 + offset : baseRad - Math.PI / 2 - offset;
}

/** Closed chain loop: big ring → cog → upper and lower jockey wheels → big ring. */
export function chainLoop(g: Readonly<BikeGeometry>): Point3[] {
  const ringRadius = pitchRadiusM(RING_TEETH);
  const cogRadius = pitchRadiusM(CASSETTE_TEETH[CHAIN_COG]);
  const ring: Point2 = [g.bottomBracket[0], g.bottomBracket[1]];
  const cog: Point2 = [g.rearAxle[0], g.rearAxle[1]];
  const upper: Point2 = [cog[0] - 0.004, cog[1] - 0.066];
  const lower: Point2 = [cog[0] + 0.022, cog[1] - 0.138];
  const topRad = tangentRad(cog, ring, cogRadius, ringRadius, true);
  const bottomRad = tangentRad(lower, ring, PULLEY_RADIUS_M, ringRadius, false);

  const points = [
    ...arcPoints(cog, cogRadius, topRad, Math.PI * 1.5, cogZ(CHAIN_COG)),
    ...arcPoints(upper, PULLEY_RADIUS_M, Math.PI, Math.PI * 1.25, cogZ(CHAIN_COG)),
    ...arcPoints(lower, PULLEY_RADIUS_M, Math.PI * 0.85, Math.PI * 1.9, cogZ(CHAIN_COG)),
    ...arcPoints(ring, ringRadius, bottomRad, topRad, g.chainlineZM + 0.0045),
  ];

  return [...points, points[0] ?? [0, 0, 0]];
}

/** Point at an arc length along a closed polyline. */
function pointAlong(
  loop: readonly Point3[],
  lengths: readonly number[],
  distanceM: number,
): Point3 {
  const total = lengths.at(-1) ?? 1;
  const wrapped = ((distanceM % total) + total) % total;

  const index = Math.max(
    1,
    lengths.findIndex((length) => length >= wrapped),
  );

  const a = loop[index - 1] ?? [0, 0, 0];
  const b = loop[index] ?? a;
  const start = lengths[index - 1] ?? 0;
  const span = (lengths[index] ?? start) - start;

  return mix(a, b, span <= 0 ? 0 : (wrapped - start) / span);
}

function addChain(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const loop = chainLoop(g);
  const lengths = loop.map((_, index) => index);
  let total = 0;

  for (const [index, point] of loop.entries()) {
    const previous = loop[index - 1] ?? point;

    total += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
    lengths[index] = total;
  }

  for (let link = 0; link < Math.floor(total / CHAIN_PITCH_M); link += 1) {
    const start = pointAlong(loop, lengths, link * CHAIN_PITCH_M);
    const end = pointAlong(loop, lengths, (link + 1) * CHAIN_PITCH_M);
    const widthM = link % 2 === 0 ? 0.0097 : 0.0075;

    bucket.add(
      "drivetrain",
      new THREE.BoxGeometry(CHAIN_PITCH_M + 0.002, 0.0076, widthM),
      placed(mix(start, end, 0.5), [0, 0, Math.atan2(end[1] - start[1], end[0] - start[0])]),
    );
  }
}

function addDerailleurs(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const z = cogZ(CHAIN_COG);
  const upper = add3(g.rearAxle, [-0.004, -0.066, 0]);
  const lower = add3(g.rearAxle, [0.022, -0.138, 0]);
  const hanger = add3(g.rearAxle, [-0.006, -0.018, 0]);
  const knuckle = add3(g.rearAxle, [-0.03, -0.05, 0]);
  const cageRad = Math.atan2(lower[1] - upper[1], lower[0] - upper[0]);
  const cageM = Math.hypot(lower[0] - upper[0], lower[1] - upper[1]);
  const front = add3(g.bottomBracket, [-0.055, 0.103, 0.054]);

  for (const pulley of [upper, lower]) {
    bucket.add("drivetrain", toothedRing(11, 0.0255, 0.004, 0.004), placed(withZ(pulley, z)));
    bucket.add(
      "alloy",
      taperedTube(withZ(pulley, z - 0.009), withZ(pulley, z + 0.009), 0.005, 0.005, 10),
    );
  }

  for (const [offset, radius] of [
    [0.011, 0.017],
    [-0.011, 0.013],
  ] as const) {
    bucket.add(
      "carbon",
      extrudedOutline(stadiumOutline(cageM, radius, radius * 0.9), 0.003, 0.0008),
      placed(withZ(upper, z + offset), [0, 0, cageRad]),
    );
  }

  bucket.add(
    "carbon",
    roundedBox(0.03, 0.022, 0.02, 0.007),
    placed(withZ(mix(hanger, knuckle, 0.5), 0.062), [0, 0, 0.9]),
  );
  bucket.add(
    "carbon",
    roundedBox(0.026, 0.018, 0.018, 0.006),
    placed(withZ(mix(knuckle, upper, 0.5), z + 0.012), [0, 0, -0.4]),
  );
  bucket.add("alloy", taperedTube(withZ(hanger, 0.058), withZ(hanger, 0.07), 0.006, 0.006, 10));
  bucket.add("carbon", roundedBox(0.075, 0.018, 0.012, 0.005), placed(front, [0, 0, -0.42]));
  bucket.add(
    "carbon",
    roundedBox(0.02, 0.04, 0.02, 0.006),
    placed(add3(front, [0.012, 0.03, -0.03]), [0, 0, -0.28]),
  );
}

function addCalipers(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  for (const [axle, angleRad, radius, z] of [
    [g.frontAxle, 2.75, 0.08, -0.05],
    [g.rearAxle, 0.62, 0.07, -0.057],
  ] as const) {
    const center: Point3 = [
      axle[0] + Math.cos(angleRad) * (radius - 0.008),
      axle[1] + Math.sin(angleRad) * (radius - 0.008),
      z,
    ];

    const rotation: Point3 = [0, 0, angleRad + Math.PI / 2];

    bucket.add("carbon", roundedBox(0.052, 0.03, 0.034, 0.01), placed(center, rotation));
    bucket.add(
      "carbon",
      roundedBox(0.04, 0.012, 0.018, 0.005),
      placed(add3(center, [0, 0, 0.022]), rotation),
    );
  }
}

/** Frame-mounted drivetrain and brake parts (they do not rotate with wheels or crank). */
export function addStaticDrivetrain(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  addChain(bucket, g);
  addDerailleurs(bucket, g);
  addCalipers(bucket, g);
}

export interface Crankset {
  readonly crank: THREE.Group;
  readonly pedals: readonly THREE.Group[];
}

function buildPedal(materials: BikeMaterials, lengthM: number, side: 1 | -1): THREE.Group {
  const pedal = new THREE.Group();
  const bucket = new PartBucket();

  pedal.name = side === 1 ? "pedal_r" : "pedal_l";
  pedal.position.set(side * lengthM, 0, 0);
  bucket.add("alloy", taperedTube([0, 0, side * 0.068], [0, 0, side * 0.098], 0.0055, 0.0055, 10));
  bucket.add("carbon", roundedBox(0.088, 0.016, 0.064, 0.008), placed([0.004, 0, side * 0.118]));
  bucket.add(
    "alloy",
    roundedBox(0.058, 0.003, 0.05, 0.0012),
    placed([0.002, 0.0085, side * 0.118]),
  );
  bucket.build(pedal, materials, pedal.name);

  return pedal;
}

/** Chainrings, spider, crank arms and spindle rotating about the BB; pedals are children of the crank. */
export function buildCrankset(g: Readonly<BikeGeometry>, materials: BikeMaterials): Crankset {
  const crank = new THREE.Group();
  const bucket = new PartBucket();
  const ringZ = g.chainlineZM + 0.0045;
  const arm = extrudedOutline(stadiumOutline(g.crankLengthM, 0.02, 0.0115), 0.016, 0.004);

  crank.name = "crank";
  crank.position.set(...g.bottomBracket);
  bucket.add(
    "drivetrain",
    toothedRing(RING_TEETH, pitchRadiusM(RING_TEETH) + 0.003, 0.078, 0.0022),
    placed([0, 0, ringZ]),
  );
  bucket.add(
    "drivetrain",
    toothedRing(34, pitchRadiusM(34) + 0.003, 0.054, 0.0022),
    placed([0, 0, ringZ - 0.0085]),
  );
  bucket.add("carbon", arm.clone(), placed([0, 0, 0.066]));
  bucket.add("carbon", arm, placed([0, 0, -0.066], [0, 0, Math.PI]));

  for (let spider = 0; spider < 4; spider += 1) {
    const angleRad = (spider / 4) * Math.PI * 2 + Math.PI / 4;
    const bolt: Point2 = [Math.cos(angleRad) * 0.078, Math.sin(angleRad) * 0.078];

    bucket.add(
      "carbon",
      roundedBox(0.064, 0.011, 0.007, 0.004),
      placed(
        [Math.cos(angleRad) * 0.046, Math.sin(angleRad) * 0.046, ringZ + 0.004],
        [0, 0, angleRad],
      ),
    );
    bucket.add(
      "alloy",
      taperedTube([...bolt, ringZ - 0.012], [...bolt, ringZ + 0.004], 0.0042, 0.0042, 10),
    );
  }

  bucket.add("alloy", taperedTube([0, 0, -0.075], [0, 0, 0.075], 0.012, 0.012, 16));
  bucket.build(crank, materials, "crank");

  const pedals = ([1, -1] as const).map((side) => buildPedal(materials, g.crankLengthM, side));

  crank.add(...pedals);

  return { crank, pedals };
}
