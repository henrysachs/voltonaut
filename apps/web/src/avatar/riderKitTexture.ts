import type * as THREE from "three";

import type { Point2 } from "./bikeSweep.js";
import {
  COLLAR_S,
  fromBand,
  JERSEY_HEM_S,
  KIT_ATLAS,
  panelS,
  POCKET_CENTRES_RAD,
  POCKET_HALF_ANGLE_RAD,
  POCKET_S,
  torsoS,
} from "./riderAtlas.js";
import {
  angleDistance,
  blend,
  coverage,
  paintTexture,
  rgb,
  shade,
  TAU,
  type Rgb,
} from "./riderPaint.js";
import type { JerseyPanel, JerseySpec } from "./riderSpecs.js";
import { torsoSection } from "./riderTorso.js";

/** Approximate torso length (pelvis → neck) used to turn spine units into metres. */
const TORSO_M = 0.6;

/** Texel size in metres, for soft edges. */
const PX_M = 0.0035;

/** Lightning bolt (the Voltonaut mark) in a unit box, x across, y up. */
const BOLT: readonly Point2[] = [
  [0.15, 1],
  [0.75, 1],
  [0.5, 0.6],
  [0.85, 0.6],
  [0.2, -0.05],
  [0.38, 0.42],
  [0.05, 0.42],
];

function insidePolygon(polygon: readonly Point2[], x: number, y: number): boolean {
  let inside = false;

  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const [xi, yi] = polygon[index] ?? [0, 0];
    const [xj, yj] = polygon[previous] ?? [0, 0];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }

  return inside;
}

export interface KitColors {
  readonly primary: Rgb;
  readonly accent: Rgb;
}

const BIBS = rgb(0x16191c);
const BIBS_GRIPPER = rgb(0x30353a);
const ZIP_TAPE = rgb(0x24272a);
const ZIP_TEETH = rgb(0xa8acb0);

/** Golden-angle spread of polka dots: even, deterministic coverage without a random seed. */
function dotCoverage(
  count: number,
  radiusM: number,
  s: number,
  angle: number,
  torsoRadiusM: number,
): number {
  let best = 0;

  for (let dot = 0; dot < count; dot += 1) {
    const dotS = panelS(0.08 + 0.84 * ((dot + 0.5) / count));

    if (Math.abs(s - dotS) * TORSO_M > radiusM + PX_M) continue;

    const across = angleDistance(angle, (dot * 2.39996) % TAU) * torsoRadiusM;

    best = Math.max(best, coverage(Math.hypot((s - dotS) * TORSO_M, across) - radiusM, PX_M));
  }

  return best;
}

/** How much of a texel the accent panel covers (soft-edged). */
function panelCoverage(
  panel: Readonly<JerseyPanel>,
  s: number,
  angle: number,
  radiusM: number,
): number {
  if (panel.kind === "dots") return dotCoverage(panel.count, panel.radiusM, s, angle, radiusM);

  const from = panelS(panel.t[0]);
  const to = panelS(panel.t[1]);
  const outside = Math.max(from - s, s - to) * TORSO_M;

  if (panel.kind === "band") return coverage(outside, PX_M);

  const t = Math.min(1, Math.max(0, (s - from) / Math.max(1e-6, to - from)));
  const centre = panel.angleRad[0] + (panel.angleRad[1] - panel.angleRad[0]) * t;
  const across = (angleDistance(angle, centre) - panel.halfWidthRad) * radiusM;

  return coverage(Math.max(across, outside), PX_M);
}

/** One texel of the torso band: spine position, angle around the body and local radius. */
interface TorsoTexel {
  readonly s: number;
  readonly angle: number;
  readonly radiusM: number;
}

function paintBolt(texel: Readonly<TorsoTexel>, color: Rgb, accent: Rgb): Rgb {
  const { s, angle, radiusM } = texel;
  const side = Math.sign(Math.sin(angle - Math.PI * 1.5 + 1e-6));
  const x = (angleDistance(angle, (Math.PI * 3) / 2) * side * radiusM) / 0.07 + 0.5;
  const y = ((s - 0.6) * TORSO_M) / 0.09;
  const inBox = Math.abs(x - 0.5) < 0.6 && y > -0.1 && y < 1.1;

  return inBox && insidePolygon(BOLT, x, y) ? blend(color, accent, 0.95) : color;
}

/** Side seams and the elastic hem. */
function paintSeams(texel: Readonly<TorsoTexel>, color: Rgb): Rgb {
  const { s, angle, radiusM } = texel;
  const seam = Math.min(angleDistance(angle, 0), angleDistance(angle, Math.PI)) * radiusM;
  const seamed = shade(color, 1 - 0.18 * coverage(seam - 0.0012, PX_M));
  const hem = s - JERSEY_HEM_S;

  return hem < 0.03 ? shade(seamed, hem < 0.026 ? 0.84 : 0.7) : seamed;
}

/** Rear pockets: stitched top edge and side seams. */
function paintPockets(texel: Readonly<TorsoTexel>, color: Rgb): Rgb {
  const { s, angle, radiusM } = texel;

  if (s < POCKET_S[0] || s > POCKET_S[1] + 0.01) return color;

  let pocketed = color;

  for (const centre of POCKET_CENTRES_RAD) {
    const across = angleDistance(angle, centre);

    if (across < POCKET_HALF_ANGLE_RAD + 0.02) {
      const top = Math.abs(s - POCKET_S[1]) * TORSO_M;
      const side = Math.abs(across - POCKET_HALF_ANGLE_RAD) * radiusM;
      const line = Math.min(top, s < POCKET_S[1] ? side : 1);

      pocketed = shade(pocketed, 1 - 0.3 * coverage(line - 0.0015, PX_M));
    }
  }

  return pocketed;
}

/** Front zip: dark tape, light teeth and the pull at the collar. */
function paintZip(texel: Readonly<TorsoTexel>, color: Rgb): Rgb {
  const { s, angle, radiusM } = texel;

  if (s <= 0.42) return color;

  const across = angleDistance(angle, Math.PI / 2) * radiusM;
  const teeth = Math.sin(((s * TORSO_M) / 0.0025) * Math.PI) > 0 ? 1 : 0.6;
  const taped = blend(color, ZIP_TAPE, coverage(across - 0.006, PX_M));
  const toothed = blend(taped, ZIP_TEETH, coverage(across - 0.0022, PX_M) * teeth);
  const pull = s > COLLAR_S - 0.09 && s < COLLAR_S - 0.045;

  return pull ? blend(toothed, ZIP_TEETH, coverage(across - 0.007, PX_M)) : toothed;
}

function paintTorso(
  jersey: Readonly<JerseySpec>,
  colors: Readonly<KitColors>,
  u: number,
  v: number,
): Rgb {
  const s = torsoS(v);
  const angle = u * TAU;
  const [halfWidth, chest, back] = torsoSection(s);
  const texel = { s, angle, radiusM: (halfWidth + (Math.sin(angle) > 0 ? chest : back)) / 2 };

  if (s < JERSEY_HEM_S) {
    const seam = coverage(angleDistance(angle, Math.PI / 2) * texel.radiusM - 0.0012, PX_M);

    return shade(BIBS, 1 - 0.25 * seam);
  }

  if (s > COLLAR_S - 0.05) return jersey.collar ? colors.accent : shade(colors.primary, 0.9);

  let color = colors.primary;

  for (const panel of jersey.panels) {
    color = blend(color, colors.accent, panelCoverage(panel, s, angle, texel.radiusM));
  }

  return paintZip(
    texel,
    paintPockets(texel, paintSeams(texel, paintBolt(texel, color, colors.accent))),
  );
}

function paintSleeve(
  jersey: Readonly<JerseySpec>,
  colors: Readonly<KitColors>,
  u: number,
  t: number,
): Rgb {
  const top = angleDistance(u * TAU, Math.PI / 2) < 0.04 ? 0.88 : 1;

  if (t > 0.84)
    return shade(
      jersey.cuffs ? colors.accent : colors.primary,
      t > 0.97 ? 0.75 : jersey.cuffs ? 1 : 0.88,
    );

  return shade(colors.primary, top);
}

function paintLeg(u: number, t: number): Rgb {
  if (t > 0.88) return t > 0.985 ? shade(BIBS_GRIPPER, 0.7) : BIBS_GRIPPER;

  const seam = angleDistance(u * TAU, Math.PI) < 0.03 ? 0.7 : 1;

  return shade(BIBS, seam);
}

/** Jersey, sleeves and bib shorts in one atlas, recoloured whenever the jersey colours change. */
export function paintKit(
  jersey: Readonly<JerseySpec>,
  colors: Readonly<KitColors>,
  size = 512,
): THREE.DataTexture {
  return paintTexture(
    size,
    (u, v) => {
      const torso = fromBand(KIT_ATLAS.torso, v);

      if (torso !== undefined) return paintTorso(jersey, colors, u, torso);

      const sleeve = fromBand(KIT_ATLAS.sleeve, v);

      if (sleeve !== undefined) return paintSleeve(jersey, colors, u, sleeve);

      const leg = fromBand(KIT_ATLAS.leg, v);

      return leg === undefined ? colors.primary : paintLeg(u, leg);
    },
    size / 2,
  );
}
