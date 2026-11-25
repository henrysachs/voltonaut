/**
 * Data-driven bike variants. A shop item points at a spec through its `assetRef`
 * (`procedural://bike/frame/<key>` or `procedural://bike/wheels/<key>`); adding a new
 * frame or wheelset is a new entry here plus a catalog item, no new mesh code.
 */

export type TubeSection = "round" | "aero";

/** Cross-section of a tube from its start (index 0) to its end (index 1). */
export interface TubeSpec {
  readonly section: TubeSection;
  /** Half width across the bike. */
  readonly lateralM: readonly [number, number];
  /** Half depth in the tube's travel/vertical direction. */
  readonly depthM: readonly [number, number];
}

/** Fit numbers as printed in a manufacturer geometry chart (size ~56). */
export interface FrameChart {
  readonly stackM: number;
  readonly reachM: number;
  readonly headAngleDeg: number;
  readonly seatAngleDeg: number;
  readonly chainstayM: number;
  readonly bbDropM: number;
  readonly forkOffsetM: number;
  readonly headTubeM: number;
  readonly seatTubeM: number;
  /** How far below the top-tube junction the seatstays join (dropped stays on aero frames). */
  readonly seatstayJoinBelowM: number;
}

export interface FrameSpec {
  readonly key: string;
  readonly chart: FrameChart;
  readonly tubes: {
    readonly headTube: TubeSpec;
    readonly topTube: TubeSpec;
    readonly downTube: TubeSpec;
    readonly seatTube: TubeSpec;
    readonly chainstay: TubeSpec;
    readonly seatstay: TubeSpec;
    readonly forkBlade: TubeSpec;
    readonly seatpost: TubeSpec;
  };
  readonly tireWidthM: number;
  readonly tireSidewallColor: number;
  readonly barHalfWidthM: number;
  /** Down-tube band colour (decal). */
  readonly decalColor: number;
}

export interface WheelSpec {
  readonly key: string;
  readonly rimDepthM: number;
  readonly rimHalfWidthM: number;
  readonly spokeCount: number;
  /** Rear wheel is a closed disc (no spokes). */
  readonly rearDisc: boolean;
  readonly rimColor: number;
  readonly rimMetalness: number;
  readonly rimRoughness: number;
}

function round(
  lateral: readonly [number, number],
  depth: readonly [number, number] = lateral,
): TubeSpec {
  return { section: "round", lateralM: lateral, depthM: depth };
}

function aero(lateral: readonly [number, number], depth: readonly [number, number]): TubeSpec {
  return { section: "aero", lateralM: lateral, depthM: depth };
}

const RACE: FrameSpec = {
  key: "race",
  chart: {
    stackM: 0.565,
    reachM: 0.39,
    headAngleDeg: 73,
    seatAngleDeg: 73.5,
    chainstayM: 0.405,
    bbDropM: 0.07,
    forkOffsetM: 0.045,
    headTubeM: 0.155,
    seatTubeM: 0.53,
    seatstayJoinBelowM: 0.025,
  },
  tubes: {
    headTube: round([0.029, 0.023], [0.029, 0.024]),
    topTube: round([0.023, 0.018], [0.02, 0.016]),
    downTube: round([0.029, 0.035], [0.025, 0.024]),
    seatTube: round([0.02, 0.018], [0.019, 0.0175]),
    chainstay: round([0.012, 0.007], [0.019, 0.01]),
    seatstay: round([0.0092, 0.0066], [0.0105, 0.0078]),
    forkBlade: aero([0.0125, 0.0075], [0.021, 0.012]),
    seatpost: round([0.0136, 0.0136]),
  },
  tireWidthM: 0.026,
  tireSidewallColor: 0x1b1b1c,
  barHalfWidthM: 0.21,
  decalColor: 0x15181b,
};

const AERO: FrameSpec = {
  key: "aero",
  chart: {
    stackM: 0.555,
    reachM: 0.395,
    headAngleDeg: 73.2,
    seatAngleDeg: 73.5,
    chainstayM: 0.405,
    bbDropM: 0.072,
    forkOffsetM: 0.045,
    headTubeM: 0.15,
    seatTubeM: 0.515,
    seatstayJoinBelowM: 0.11,
  },
  tubes: {
    headTube: aero([0.025, 0.021], [0.038, 0.032]),
    topTube: round([0.02, 0.016], [0.022, 0.016]),
    downTube: aero([0.02, 0.026], [0.034, 0.027]),
    seatTube: aero([0.018, 0.0155], [0.031, 0.023]),
    chainstay: round([0.012, 0.007], [0.02, 0.01]),
    seatstay: round([0.0078, 0.0062], [0.014, 0.0095]),
    forkBlade: aero([0.012, 0.0072], [0.025, 0.014]),
    seatpost: aero([0.0125, 0.0125], [0.022, 0.022]),
  },
  tireWidthM: 0.028,
  tireSidewallColor: 0x1b1b1c,
  barHalfWidthM: 0.2,
  decalColor: 0xf2f2ee,
};

const GRAVEL: FrameSpec = {
  key: "gravel",
  chart: {
    stackM: 0.585,
    reachM: 0.382,
    headAngleDeg: 71.5,
    seatAngleDeg: 73.5,
    chainstayM: 0.425,
    bbDropM: 0.072,
    forkOffsetM: 0.05,
    headTubeM: 0.17,
    seatTubeM: 0.5,
    seatstayJoinBelowM: 0.04,
  },
  tubes: {
    headTube: round([0.029, 0.024]),
    topTube: round([0.021, 0.017], [0.019, 0.015]),
    downTube: round([0.03, 0.035], [0.026, 0.025]),
    seatTube: round([0.0195, 0.0175]),
    chainstay: round([0.0125, 0.0075], [0.019, 0.011]),
    seatstay: round([0.0095, 0.007]),
    forkBlade: round([0.014, 0.009], [0.019, 0.012]),
    seatpost: round([0.0136, 0.0136]),
  },
  tireWidthM: 0.04,
  tireSidewallColor: 0x8a5a32,
  barHalfWidthM: 0.22,
  decalColor: 0x1e2a24,
};

/** Registry of frame builds; add an entry here and point a catalog item's assetRef at its key. */
export const FRAME_SPECS = [RACE, AERO, GRAVEL] as const satisfies readonly FrameSpec[];

const ALLOY: WheelSpec = {
  key: "alloy",
  rimDepthM: 0.024,
  rimHalfWidthM: 0.0125,
  spokeCount: 24,
  rearDisc: false,
  rimColor: 0xd3dadb,
  rimMetalness: 0.55,
  rimRoughness: 0.25,
};

/** Registry of wheelsets; add an entry here and point a catalog item's assetRef at its key. */
export const WHEEL_SPECS = [
  ALLOY,
  {
    // Season 01 „Winterblitz“ reward: deep icy-white carbon rims.
    key: "season-01",
    rimDepthM: 0.05,
    rimHalfWidthM: 0.0135,
    spokeCount: 20,
    rearDisc: false,
    rimColor: 0xe6eef2,
    rimMetalness: 0.2,
    rimRoughness: 0.28,
  },
  {
    key: "carbon-flat",
    rimDepthM: 0.04,
    rimHalfWidthM: 0.013,
    spokeCount: 24,
    rearDisc: false,
    rimColor: 0x2b3034,
    rimMetalness: 0.15,
    rimRoughness: 0.42,
  },
  {
    key: "carbon-deep",
    rimDepthM: 0.058,
    rimHalfWidthM: 0.0135,
    spokeCount: 20,
    rearDisc: false,
    rimColor: 0x1d2023,
    rimMetalness: 0.15,
    rimRoughness: 0.32,
  },
  {
    key: "disc",
    rimDepthM: 0.058,
    rimHalfWidthM: 0.0135,
    spokeCount: 20,
    rearDisc: true,
    rimColor: 0x1d2023,
    rimMetalness: 0.15,
    rimRoughness: 0.32,
  },
] as const satisfies readonly WheelSpec[];

export const DEFAULT_FRAME_SPEC = RACE;
export const DEFAULT_WHEEL_SPEC = ALLOY;

const PROCEDURAL_PREFIX = "procedural://bike/";

/** Resolves `procedural://bike/<slot>/<key>`; unknown or non-procedural refs fall back to the default. */
function specKey(assetRef: string | undefined, slot: "frame" | "wheels"): string | undefined {
  const prefix = `${PROCEDURAL_PREFIX}${slot}/`;

  return assetRef?.startsWith(prefix) === true ? assetRef.slice(prefix.length) : undefined;
}

export function frameSpecFor(assetRef: string | undefined): FrameSpec {
  const key = specKey(assetRef, "frame");

  return FRAME_SPECS.find((spec) => spec.key === key) ?? DEFAULT_FRAME_SPEC;
}

export function wheelSpecFor(assetRef: string | undefined): WheelSpec {
  const key = specKey(assetRef, "wheels");

  return WHEEL_SPECS.find((spec) => spec.key === key) ?? DEFAULT_WHEEL_SPEC;
}
