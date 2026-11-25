export type Point3 = readonly [number, number, number];

import type { FrameChart, FrameSpec, WheelSpec } from "./bikeSpecs.js";

/** One rider fit shared by all frames: saddle height measured BB → saddle top along the seat tube. */
const SADDLE_HEIGHT_M = 0.735;
const CRANK_LENGTH_M = 0.1725;
const STEM_LENGTH_M = 0.1;
const STEM_ANGLE_RAD = (-6 * Math.PI) / 180;
const SPACER_STACK_M = 0.03;

export interface BikeGeometry {
  readonly frame: FrameSpec;
  readonly wheel: WheelSpec;
  /** Tire outer radius; equals wheel circumference / 2π. */
  readonly wheelRadiusM: number;
  readonly tireWidthM: number;
  /** Radius where the tire bead meets the rim. */
  readonly rimRadiusM: number;
  readonly rimDepthM: number;
  readonly crankLengthM: number;
  readonly bottomBracket: Point3;
  readonly rearAxle: Point3;
  readonly frontAxle: Point3;
  readonly headTubeTop: Point3;
  readonly headTubeBottom: Point3;
  /** Unit vector along the steering axis pointing up. */
  readonly steeringAxis: Point3;
  /** Unit vector along the seat tube pointing up. */
  readonly seatAxis: Point3;
  readonly seatTubeTop: Point3;
  readonly seatstayJoin: Point3;
  readonly steererTop: Point3;
  readonly barClamp: Point3;
  readonly barHalfWidthM: number;
  /** Where the palm rests on the brake hoods (z = right side). */
  readonly hoodGrip: Point3;
  readonly saddleTop: Point3;
  readonly hip: Point3;
  readonly pedalOffsetZM: number;
  readonly chainlineZM: number;
}

function add(a: Point3, b: Point3, scale = 1): Point3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

interface FrameAnchors {
  readonly steeringAxis: Point3;
  readonly seatAxis: Point3;
  readonly bottomBracket: Point3;
  readonly rearAxle: Point3;
  readonly frontAxle: Point3;
  readonly headTubeTop: Point3;
  readonly headTubeBottom: Point3;
}

/** BB, axles and head tube from the chart, shifted so the wheelbase is centred on x = 0. */
function frameAnchors(chart: Readonly<FrameChart>, wheelRadiusM: number): FrameAnchors {
  const bbY = wheelRadiusM - chart.bbDropM;
  const rearX = -Math.sqrt(chart.chainstayM ** 2 - chart.bbDropM ** 2);
  const headAngle = radians(chart.headAngleDeg);
  const seatAngle = radians(chart.seatAngleDeg);
  const steeringAxis: Point3 = [-Math.cos(headAngle), Math.sin(headAngle), 0];
  const headTop: Point3 = [chart.reachM, bbY + chart.stackM, 0];
  const toAxleT = (headTop[1] - wheelRadiusM) / steeringAxis[1];
  const frontX = headTop[0] - steeringAxis[0] * toAxleT + chart.forkOffsetM / Math.sin(headAngle);
  const shift: Point3 = [-(rearX + frontX) / 2, 0, 0];

  return {
    steeringAxis,
    seatAxis: [-Math.cos(seatAngle), Math.sin(seatAngle), 0],
    bottomBracket: add([0, bbY, 0], shift),
    rearAxle: add([rearX, wheelRadiusM, 0], shift),
    frontAxle: add([frontX, wheelRadiusM, 0], shift),
    headTubeTop: add(headTop, shift),
    headTubeBottom: add(add(headTop, steeringAxis, -chart.headTubeM), shift),
  };
}

/**
 * Derives every hard point of the bike from a geometry chart. +X is forward, +Y up,
 * +Z the drive (right) side; the ground is y = 0 and the wheelbase is centered on x = 0.
 */
export function bikeGeometry(
  wheelCircM: number,
  frame: Readonly<FrameSpec>,
  wheel: Readonly<WheelSpec>,
): BikeGeometry {
  const wheelRadiusM = wheelCircM / (2 * Math.PI);
  const anchors = frameAnchors(frame.chart, wheelRadiusM);
  const seatTubeTop = add(anchors.bottomBracket, anchors.seatAxis, frame.chart.seatTubeM);
  const steererTop = add(anchors.headTubeTop, anchors.steeringAxis, SPACER_STACK_M);
  const saddleTop = add(anchors.bottomBracket, anchors.seatAxis, SADDLE_HEIGHT_M);

  const barClamp: Point3 = [
    steererTop[0] + Math.cos(STEM_ANGLE_RAD) * STEM_LENGTH_M,
    steererTop[1] + Math.sin(STEM_ANGLE_RAD) * STEM_LENGTH_M,
    0,
  ];

  return {
    ...anchors,
    frame,
    wheel,
    wheelRadiusM,
    tireWidthM: frame.tireWidthM,
    rimRadiusM: wheelRadiusM - frame.tireWidthM * 0.92,
    rimDepthM: wheel.rimDepthM,
    crankLengthM: CRANK_LENGTH_M,
    seatTubeTop,
    seatstayJoin: add(seatTubeTop, anchors.seatAxis, -frame.chart.seatstayJoinBelowM),
    steererTop,
    barClamp,
    barHalfWidthM: frame.barHalfWidthM,
    hoodGrip: [barClamp[0] + 0.072, barClamp[1] + 0.028, frame.barHalfWidthM],
    saddleTop,
    hip: [saddleTop[0] + 0.01, saddleTop[1] + 0.07, 0.085],
    pedalOffsetZM: 0.118,
    chainlineZM: 0.0435,
  };
}

/** Right pedal spindle centre for a crank angle; the left pedal is offset by π. */
export function pedalPoint(
  geometry: Readonly<BikeGeometry>,
  crankRad: number,
  side: 1 | -1,
): Point3 {
  const angleRad = crankRad + (side === 1 ? 0 : Math.PI);

  return [
    geometry.bottomBracket[0] + Math.cos(angleRad) * geometry.crankLengthM,
    geometry.bottomBracket[1] - Math.sin(angleRad) * geometry.crankLengthM,
    side * geometry.pedalOffsetZM,
  ];
}
