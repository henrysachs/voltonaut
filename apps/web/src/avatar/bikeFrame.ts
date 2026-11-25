import type { BikeGeometry, Point3 } from "./bikeGeometry.js";
import type { BikeMaterialKey, PartBucket } from "./bikeMaterials.js";
import { placed, roundedBox } from "./bikeMesh.js";
import type { TubeSpec } from "./bikeSpecs.js";
import {
  add3,
  aeroSection,
  ellipseSection,
  FORWARD,
  LATERAL,
  lerp,
  mix,
  smoothPath,
  sweepGeometry,
  taperedTube,
  UP,
  withZ,
  type Point2,
  type SectionProfile,
} from "./bikeSweep.js";

/** Tapered cross-section for a tube spec; `segments` trades smoothness for triangles. */
export function tubeProfile(tube: Readonly<TubeSpec>, segments = 14): SectionProfile {
  const aero = tube.section === "aero";
  const section = aero ? aeroSection : ellipseSection;

  return (t) =>
    section(
      aero ? segments + 2 : segments,
      lerp(tube.lateralM[0], tube.lateralM[1], t),
      lerp(tube.depthM[0], tube.depthM[1], t),
    );
}

/** Adds a capped sweep; `forward` orients the section's depth (travel or vertical). */
export function addSweep(
  bucket: Readonly<PartBucket>,
  key: BikeMaterialKey,
  path: readonly Point3[],
  profile: SectionProfile,
  forward: Point3 = FORWARD,
): void {
  bucket.add(key, sweepGeometry(path, profile, { lateral: LATERAL, forward, caps: true }));
}

function addMainTriangle(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const { tubes } = g.frame;
  const axis = g.steeringAxis;
  const head = [add3(g.headTubeBottom, axis, -0.012), add3(g.headTubeTop, axis, 0.004)];
  const topFront = add3(add3(g.headTubeTop, axis, -0.03), [-0.008, 0, 0]);
  const topRear = add3(g.seatTubeTop, g.seatAxis, -0.018);
  const downFront = add3(add3(g.headTubeBottom, axis, 0.045), [-0.012, 0, 0]);
  const downProfile = tubeProfile(tubes.downTube, 16);
  const seat = [add3(g.bottomBracket, g.seatAxis, -0.01), add3(g.seatTubeTop, g.seatAxis, 0.004)];

  addSweep(bucket, "paint", smoothPath(head, 4), tubeProfile(tubes.headTube, 20));
  addSweep(bucket, "paint", smoothPath([topFront, topRear], 4), tubeProfile(tubes.topTube), UP);
  addSweep(bucket, "paint", smoothPath([downFront, g.bottomBracket], 6), downProfile);
  addSweep(bucket, "paint", smoothPath(seat, 4), tubeProfile(tubes.seatTube));
  bucket.add(
    "accent",
    sweepGeometry(
      smoothPath([mix(downFront, g.bottomBracket, 0.3), mix(downFront, g.bottomBracket, 0.62)], 10),
      (t) => downProfile(0.3 + t * 0.32).map(([u, v]): Point2 => [u * 1.035, v * 1.035]),
      { lateral: LATERAL, forward: FORWARD, caps: false },
    ),
  );
  bucket.add(
    "paint",
    taperedTube(withZ(g.bottomBracket, -0.043), withZ(g.bottomBracket, 0.043), 0.0235, 0.0235, 20),
  );
  bucket.add(
    "carbon",
    taperedTube(
      add3(g.seatTubeTop, g.seatAxis, -0.02),
      add3(g.seatTubeTop, g.seatAxis, 0.004),
      0.0205,
      0.0205,
      18,
    ),
  );
}

function addRearTriangleSide(
  bucket: Readonly<PartBucket>,
  g: Readonly<BikeGeometry>,
  side: 1 | -1,
): void {
  const bb = g.bottomBracket;
  const axle = g.rearAxle;
  const stayTop = add3(g.seatstayJoin, [-0.01, 0, side * 0.017]);

  const chainstay = smoothPath(
    [
      add3(bb, [-0.015, -0.004, side * 0.026]),
      add3(bb, [-0.13, 0.018, side * 0.034]),
      add3(axle, [0.12, -0.012, side * 0.058]),
      add3(axle, [0.012, 0, side * 0.0655]),
    ],
    12,
  );

  const seatstay = smoothPath(
    [
      stayTop,
      add3(mix(stayTop, axle, 0.5), [0, 0, side * 0.025]),
      add3(axle, [0.008, 0.012, side * 0.064]),
    ],
    10,
  );

  addSweep(bucket, "paint", chainstay, tubeProfile(g.frame.tubes.chainstay, 12), UP);
  addSweep(bucket, "paint", seatstay, tubeProfile(g.frame.tubes.seatstay, 12));
  bucket.add(
    "paint",
    roundedBox(0.038, 0.032, 0.007, 0.01),
    placed(add3(axle, [0.006, 0.004, side * 0.065]), [0, 0, 0.4]),
  );
  bucket.add(
    "alloy",
    taperedTube(withZ(axle, side * 0.069), withZ(axle, side * 0.078), 0.0085, 0.0085, 12),
  );
}

function addFork(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  const axis = g.steeringAxis;
  const crown = add3(g.headTubeBottom, axis, -0.022);

  bucket.add(
    "paint",
    roundedBox(0.04, 0.02, 0.086, 0.009),
    placed(crown, [0, 0, Math.atan2(axis[0], axis[1])]),
  );

  for (const side of [-1, 1] as const) {
    const top = withZ(add3(crown, axis, 0.004), side * 0.04);
    const bottom = withZ(add3(g.frontAxle, [0.003, 0.006, 0]), side * 0.054);

    const blade = smoothPath(
      [top, add3(mix(top, bottom, 0.55), [0.008, 0, side * 0.004]), bottom],
      12,
    );

    addSweep(bucket, "paint", blade, tubeProfile(g.frame.tubes.forkBlade));
    bucket.add(
      "alloy",
      taperedTube(
        withZ(g.frontAxle, side * 0.056),
        withZ(g.frontAxle, side * 0.064),
        0.008,
        0.008,
        12,
      ),
    );
  }
}

/** Painted frame and fork, built from the frame spec's geometry chart and tube sections. */
export function addFrame(bucket: Readonly<PartBucket>, g: Readonly<BikeGeometry>): void {
  addMainTriangle(bucket, g);
  addRearTriangleSide(bucket, g, 1);
  addRearTriangleSide(bucket, g, -1);
  addFork(bucket, g);
  bucket.add(
    "alloy",
    roundedBox(0.012, 0.03, 0.004, 0.002),
    placed(add3(g.rearAxle, [-0.004, -0.02, 0.071]), [0, 0, 0.2]),
  );
}
