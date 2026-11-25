import type * as THREE from "three";

import { EYE, skullPoint } from "./riderFace.js";
import { BETA_BACK, BETA_FRONT, ventMask, ventsOf } from "./riderHelmet.js";
import { fromBand, SKIN_ATLAS } from "./riderAtlas.js";
import { blend, coverage, cssRgb, paintTexture, rgb, shade, TAU, type Rgb } from "./riderPaint.js";
import type { HelmetSpec, ShoeSpec } from "./riderSpecs.js";

const HAIR = rgb(0x2b2019);
const SCLERA = rgb(0xeeeae2);
const IRIS = rgb(0x5b4130);
const PUPIL = rgb(0x0d0b0a);

function paintFace(skin: Rgb, u: number, v: number): Rgb {
  const [x, y, z] = skullPoint(u, v);
  const across = Math.abs(z);
  const lip = blend(skin, [skin[0] * 0.85 + 30, skin[1] * 0.62, skin[2] * 0.62], 0.75);
  let color = skin;

  // Short hair on the back and sides; ears and face stay clear.
  const behindEars = x + 0.022 + 0.25 * (y - 0.1);
  const hair = Math.min(-behindEars, y - 0.05);

  color = blend(color, HAIR, coverage(-hair, 0.008));

  if (x > 0.06) {
    // Brows: a slight arch above each eye.
    const browY = 0.127 + 0.004 * Math.cos(((across - 0.032) / 0.02) * 1.2);

    const brow =
      coverage(Math.abs(y - browY) - 0.0032, 0.002) *
      coverage(Math.abs(across - 0.033) - 0.019, 0.003);

    color = blend(color, HAIR, brow * 0.9);

    // Lips: upper and lower lip around a darker parting line.
    const mouth = Math.abs(across) / 0.023;
    const lipY = 0.049 - 0.002 * mouth ** 2;

    if (mouth < 1) {
      const parting = coverage(Math.abs(y - lipY) - 0.0008, 0.0012);
      const body = coverage(Math.abs(y - lipY + 0.001) - 0.0055 * (1 - mouth ** 4), 0.0015);

      color = blend(color, lip, body);
      color = blend(color, shade(lip, 0.55), parting);
    }

    // Lash line on the upper lid and a soft socket shadow.
    const eye = Math.hypot(y - EYE[1], across - EYE[2]);

    color = shade(color, 1 - 0.12 * coverage(eye - 0.02, 0.012));

    if (y > EYE[1])
      color = blend(color, HAIR, coverage(Math.abs(eye - 0.0128) - 0.0011, 0.0012) * 0.8);
  }

  return color;
}

function paintEye(u: number, v: number): Rgb {
  const azimuth = u * TAU;
  const polar = Math.PI * (1 - v);
  const forward = Math.sin(polar) * Math.cos(azimuth);
  const angle = Math.acos(Math.min(1, Math.max(-1, forward)));
  let color = SCLERA;

  color = blend(color, IRIS, coverage(angle - 0.52, 0.06));
  color = blend(color, shade(IRIS, 0.6), coverage(Math.abs(angle - 0.5) - 0.03, 0.04));

  return blend(color, PUPIL, coverage(angle - 0.2, 0.05));
}

/** Face (hair, brows, lips, lids), eyeballs and plain skin, painted in the rider's skin tone. */
export function paintSkin(skinTone: string, size = 256): THREE.DataTexture {
  const skin = cssRgb(skinTone);

  return paintTexture(size, (u, v) => {
    const face = fromBand(SKIN_ATLAS.face, v);

    if (face !== undefined) return paintFace(skin, u, face);

    const eye = fromBand(SKIN_ATLAS.eye, v);

    return eye === undefined ? skin : paintEye(u, eye);
  });
}

const WHITE = rgb(0xffffff);
const VENT = rgb(0x141516);

/** Helmet detail multiplied with the shell colour: vents, their rims and two side lines. */
export function paintHelmet(spec: Readonly<HelmetSpec>, size = 256): THREE.DataTexture {
  const vents = ventsOf(spec);

  return paintTexture(size, (u, v) => {
    const gamma = (u - 0.5) * Math.PI;
    const beta = BETA_FRONT + (BETA_BACK - BETA_FRONT) * v;
    const vent = ventMask(vents, gamma, beta);
    const rim = Math.max(0, 1 - Math.min(v, 1 - v) / 0.025);

    const line =
      coverage(Math.abs(Math.abs(gamma) - 0.98) - 0.012, 0.01) * (beta > 0.7 && beta < 2.9 ? 1 : 0);

    let color = shade(WHITE, 1 - 0.25 * rim);

    color = blend(color, shade(WHITE, 0.55), line);
    color = blend(color, shade(WHITE, 0.6), Math.min(1, vent * 3));

    return blend(color, VENT, Math.max(0, vent * 1.4 - 0.4));
  });
}

/** Shoe upper: mudguard, closure straps over the instep, perforated toe box and heel tab. */
export function paintShoe(spec: Readonly<ShoeSpec>, size = 256): THREE.DataTexture {
  const upper = rgb(spec.upperColor);
  const detail = rgb(spec.detailColor);

  return paintTexture(size, (u, v) => {
    const angle = u * TAU;
    const up = Math.sin(angle);
    let color = upper;

    // Mudguard band along the sole and the heel counter.
    color = blend(
      color,
      detail,
      coverage(up - 0.14 - (0.3 * Math.max(0, 0.14 - v)) / 0.14, 0.05) * 0.9,
    );

    if (up > 0.2) {
      // Straps cross the instep, angled slightly towards the toe on the outside.
      for (const strap of spec.toeStrap ? [0.47, 0.6, 0.74] : [0.5, 0.64]) {
        const d = Math.abs(v - strap + 0.03 * Math.cos(angle)) - 0.022;

        color = blend(color, shade(detail, 0.95), coverage(d, 0.008));
        color = shade(color, 1 - 0.2 * coverage(Math.abs(d + 0.002) - 0.0015, 0.004));
      }

      if (v > 0.8 && up > 0.45) {
        const dot = Math.hypot(((v * 70) % 1) - 0.5, ((u * 110) % 1) - 0.5);

        color = shade(color, 1 - 0.3 * coverage(dot - 0.2, 0.12));
      }

      if (v < 0.06 && up > 0.7) color = blend(color, detail, 0.9);
    }

    return color;
  });
}
