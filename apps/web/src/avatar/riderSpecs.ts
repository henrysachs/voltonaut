/**
 * Data-driven rider kit. A shop item points at a spec through its `assetRef`
 * (`procedural://rider/<jersey|helmet|shoes|glasses>/<key>`); a new jersey design, helmet,
 * shoe or pair of glasses is a new entry here plus a catalog item, no new mesh code.
 */

export type RiderSlot = "jersey" | "helmet" | "shoes" | "glasses";

/**
 * Accent area on the jersey torso. `t` runs from the hem (0) to the collar (1); the angle runs
 * around the torso: 0 = right side, π/2 = chest, π = left side, 3π/2 = back.
 */
export type JerseyPanel =
  /** All-round band between two heights. */
  | { readonly kind: "band"; readonly t: readonly [number, number] }
  /**
   * Strip between two heights whose centre angle moves from `angleRad[0]` to `angleRad[1]`
   * (vertical stripes, side panels, diagonal sashes).
   */
  | {
      readonly kind: "strip";
      readonly t: readonly [number, number];
      readonly angleRad: readonly [number, number];
      readonly halfWidthRad: number;
    }
  /** Evenly spread dots (polka dots) over the torso. */
  | { readonly kind: "dots"; readonly count: number; readonly radiusM: number };

export interface JerseySpec {
  readonly key: string;
  readonly panels: readonly JerseyPanel[];
  /** Accent-coloured sleeve hems. */
  readonly cuffs: boolean;
  /** Accent-coloured collar. */
  readonly collar: boolean;
  readonly accentRoughness: number;
}

export interface HelmetSpec {
  readonly key: string;
  /** Shell half length front to back, half height and half width. */
  readonly shellM: readonly [number, number, number];
  /** Extra length of the trailing aero tail behind the head. */
  readonly tailM: number;
  /**
   * Vent columns from the centre line outwards; each entry is the number of vents front to back.
   * Column 0 sits on the centre line, every further column is mirrored to both sides.
   */
  readonly ventRows: readonly number[];
  /** Vent slot length along the shell. */
  readonly ventLengthM: number;
  /** Integrated visor in front of the eyes (aero helmets). */
  readonly visor: boolean;
  readonly shellRoughness: number;
}

export interface ShoeSpec {
  readonly key: string;
  readonly upperColor: number;
  readonly upperRoughness: number;
  /** Straps, heel tab, perforation and sole edge printed on the upper. */
  readonly detailColor: number;
  /** Number of BOA-style closure dials on the outer side (1 or 2). */
  readonly dials: number;
  /** Velcro strap across the forefoot. */
  readonly toeStrap: boolean;
}

/** Dual lenses or one wrap-around shield. */
export type LensCut = "dual" | "shield";

export interface GlassesSpec {
  readonly key: string;
  /** `undefined` = no glasses. */
  readonly lens:
    | {
        readonly cut: LensCut;
        readonly color: number;
        readonly opacity: number;
        readonly metalness: number;
      }
    | undefined;
}

const FRONT = Math.PI / 2;
const BACK = (Math.PI * 3) / 2;

export const JERSEY_SPECS = [
  {
    key: "classic",
    panels: [{ kind: "band", t: [0.56, 0.68] }],
    cuffs: true,
    collar: true,
    accentRoughness: 0.85,
  },
  {
    key: "stripe",
    panels: [
      { kind: "strip", t: [0, 1], angleRad: [FRONT, FRONT], halfWidthRad: 0.2 },
      { kind: "strip", t: [0, 1], angleRad: [BACK, BACK], halfWidthRad: 0.2 },
    ],
    cuffs: true,
    collar: false,
    accentRoughness: 0.65,
  },
  {
    key: "tempo",
    panels: [
      { kind: "strip", t: [0, 0.9], angleRad: [0, 0], halfWidthRad: 0.42 },
      { kind: "strip", t: [0, 0.9], angleRad: [Math.PI, Math.PI], halfWidthRad: 0.42 },
    ],
    cuffs: false,
    collar: true,
    accentRoughness: 0.9,
  },
  {
    key: "kom-hunter",
    panels: [{ kind: "dots", count: 26, radiusM: 0.026 }],
    cuffs: true,
    collar: true,
    accentRoughness: 0.55,
  },
  {
    key: "century",
    panels: [
      { kind: "band", t: [0.3, 0.38] },
      { kind: "band", t: [0.48, 0.56] },
      { kind: "band", t: [0.66, 0.74] },
    ],
    cuffs: false,
    collar: true,
    accentRoughness: 0.8,
  },
  {
    key: "aurora",
    panels: [
      { kind: "strip", t: [0.05, 0.95], angleRad: [FRONT - 1.1, FRONT + 1.2], halfWidthRad: 0.3 },
      { kind: "strip", t: [0.05, 0.95], angleRad: [BACK + 1.1, BACK - 1.2], halfWidthRad: 0.3 },
    ],
    cuffs: true,
    collar: false,
    accentRoughness: 0.45,
  },
  {
    key: "season-01",
    panels: [
      { kind: "band", t: [0.8, 1] },
      { kind: "band", t: [0.12, 0.2] },
    ],
    cuffs: true,
    collar: true,
    accentRoughness: 0.5,
  },
] as const satisfies readonly JerseySpec[];

export const HELMET_SPECS = [
  {
    key: "standard",
    shellM: [0.162, 0.124, 0.112],
    tailM: 0.02,
    ventRows: [3, 3, 2],
    ventLengthM: 0.05,
    visor: false,
    shellRoughness: 0.32,
  },
  {
    key: "aero",
    shellM: [0.158, 0.12, 0.11],
    tailM: 0.11,
    ventRows: [2],
    ventLengthM: 0.035,
    visor: true,
    shellRoughness: 0.18,
  },
  {
    key: "halo",
    shellM: [0.166, 0.128, 0.114],
    tailM: 0.035,
    ventRows: [4, 4, 3, 2],
    ventLengthM: 0.042,
    visor: false,
    shellRoughness: 0.4,
  },
] as const satisfies readonly HelmetSpec[];

export const SHOE_SPECS = [
  {
    key: "white",
    upperColor: 0xf5ebca,
    upperRoughness: 0.4,
    detailColor: 0x2a2f33,
    dials: 2,
    toeStrap: false,
  },
  {
    key: "carbon",
    upperColor: 0x18272e,
    upperRoughness: 0.3,
    detailColor: 0xec6b48,
    dials: 1,
    toeStrap: true,
  },
] as const satisfies readonly ShoeSpec[];

export const GLASSES_SPECS = [
  { key: "none", lens: undefined },
  {
    key: "clear",
    lens: { cut: "dual", color: 0xd8e6ee, opacity: 0.32, metalness: 0.1 },
  },
  {
    key: "sport",
    lens: { cut: "shield", color: 0xe0682a, opacity: 0.88, metalness: 0.75 },
  },
] as const satisfies readonly GlassesSpec[];

const [CLASSIC] = JERSEY_SPECS;
const [STANDARD] = HELMET_SPECS;
const [WHITE] = SHOE_SPECS;
const [NO_GLASSES] = GLASSES_SPECS;

export const DEFAULT_JERSEY_SPEC: JerseySpec = CLASSIC;
export const DEFAULT_HELMET_SPEC: HelmetSpec = STANDARD;
export const DEFAULT_SHOE_SPEC: ShoeSpec = WHITE;
export const DEFAULT_GLASSES_SPEC: GlassesSpec = NO_GLASSES;

const PROCEDURAL_PREFIX = "procedural://rider/";

/** Resolves `procedural://rider/<slot>/<key>`; unknown or non-procedural refs give `undefined`. */
function specKey(assetRef: string | undefined, slot: RiderSlot): string | undefined {
  const prefix = `${PROCEDURAL_PREFIX}${slot}/`;

  return assetRef?.startsWith(prefix) === true ? assetRef.slice(prefix.length) : undefined;
}

export function jerseySpecFor(assetRef: string | undefined): JerseySpec {
  const key = specKey(assetRef, "jersey");

  return JERSEY_SPECS.find((spec) => spec.key === key) ?? DEFAULT_JERSEY_SPEC;
}

export function helmetSpecFor(assetRef: string | undefined): HelmetSpec {
  const key = specKey(assetRef, "helmet");

  return HELMET_SPECS.find((spec) => spec.key === key) ?? DEFAULT_HELMET_SPEC;
}

export function shoeSpecFor(assetRef: string | undefined): ShoeSpec {
  const key = specKey(assetRef, "shoes");

  return SHOE_SPECS.find((spec) => spec.key === key) ?? DEFAULT_SHOE_SPEC;
}

export function glassesSpecFor(assetRef: string | undefined): GlassesSpec {
  const key = specKey(assetRef, "glasses");

  return GLASSES_SPECS.find((spec) => spec.key === key) ?? DEFAULT_GLASSES_SPEC;
}

/** The kit that one rider wears; a change of any spec rebuilds the rider meshes. */
export interface RiderKit {
  readonly jersey: JerseySpec;
  readonly helmet: HelmetSpec;
  readonly shoes: ShoeSpec;
  readonly glasses: GlassesSpec;
}

export const DEFAULT_RIDER_KIT: RiderKit = {
  jersey: DEFAULT_JERSEY_SPEC,
  helmet: DEFAULT_HELMET_SPEC,
  shoes: DEFAULT_SHOE_SPEC,
  glasses: DEFAULT_GLASSES_SPEC,
};

export function sameKit(a: Readonly<RiderKit>, b: Readonly<RiderKit>): boolean {
  return (
    a.jersey.key === b.jersey.key &&
    a.helmet.key === b.helmet.key &&
    a.shoes.key === b.shoes.key &&
    a.glasses.key === b.glasses.key
  );
}
