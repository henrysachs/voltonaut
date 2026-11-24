import * as THREE from "three";

import { BILLBOARD_VARIANTS } from "./billboard-plan.js";

/**
 * Placeholder motifs until the sponsor artwork and its licence are delivered
 * (issue #42). They are painted procedurally into one atlas, so they need no
 * asset file or licence entry. Each cell is one motif; boards pick a cell by
 * their variant. Swapping in the real motifs only replaces this texture.
 */
export const MOTIF_WIDTH_PX = 512;
export const MOTIF_HEIGHT_PX = 256;

const BORDER_PX = 12;
const BAR_WIDTH_PX = 18;
const BAR_GAP_PX = 14;

type Rgb = readonly [number, number, number];

export const MOTIF_BORDER: Rgb = [0xf3, 0xe7, 0xb8];
export const MOTIF_BOLT: Rgb = [0xff, 0xd2, 0x3f];

/** One background per variant; the bar count (1, 2, 3) tells the motifs apart without colour. */
export const MOTIF_VARIANT_BACKGROUNDS: readonly Rgb[] = [
  [0x25, 0x4c, 0x47],
  [0x2a, 0x3a, 0x6b],
  [0x6b, 0x2a, 0x3a],
];

/** Lightning bolt in a unit square (x right, y up), centred horizontally on the board. */
const BOLT: readonly (readonly [number, number])[] = [
  [0.6, 0.92],
  [0.3, 0.46],
  [0.48, 0.46],
  [0.38, 0.08],
  [0.72, 0.58],
  [0.53, 0.58],
  [0.68, 0.92],
];

function insideBolt(x: number, y: number): boolean {
  let inside = false;

  for (let index = 0, previous = BOLT.length - 1; index < BOLT.length; previous = index++) {
    const [xi, yi] = BOLT[index] ?? [0, 0];
    const [xj, yj] = BOLT[previous] ?? [0, 0];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }

  return inside;
}

/** Variant marker: 1–3 vertical bars near the right border, below the bolt's reach. */
function insideBars(xPx: number, variant: number): boolean {
  const fromRightPx = MOTIF_WIDTH_PX - BORDER_PX - 24 - xPx;

  if (fromRightPx < 0) return false;

  const bar = Math.floor(fromRightPx / (BAR_WIDTH_PX + BAR_GAP_PX));

  return bar <= variant && fromRightPx % (BAR_WIDTH_PX + BAR_GAP_PX) < BAR_WIDTH_PX;
}

function colorAt(xPx: number, yPx: number, variant: number): Rgb {
  if (
    xPx < BORDER_PX ||
    yPx < BORDER_PX ||
    xPx >= MOTIF_WIDTH_PX - BORDER_PX ||
    yPx >= MOTIF_HEIGHT_PX - BORDER_PX
  ) {
    return MOTIF_BORDER;
  }

  const v = (yPx + 0.5) / MOTIF_HEIGHT_PX;
  const u = 0.5 + ((xPx + 0.5) / MOTIF_WIDTH_PX - 0.5) * (MOTIF_WIDTH_PX / MOTIF_HEIGHT_PX);

  if (insideBolt(u, v) || (v > 0.25 && v < 0.75 && insideBars(xPx, variant))) return MOTIF_BOLT;

  return MOTIF_VARIANT_BACKGROUNDS[variant] ?? MOTIF_BORDER;
}

/** RGBA atlas, one 512 × 256 cell per variant side by side, row 0 at the bottom. */
export function paintPlaceholderAtlas(): Uint8Array {
  const widthPx = MOTIF_WIDTH_PX * BILLBOARD_VARIANTS;
  const pixels = new Uint8Array(widthPx * MOTIF_HEIGHT_PX * 4);

  for (let yPx = 0; yPx < MOTIF_HEIGHT_PX; yPx += 1) {
    for (let xPx = 0; xPx < widthPx; xPx += 1) {
      const variant = Math.floor(xPx / MOTIF_WIDTH_PX);

      pixels.set([...colorAt(xPx % MOTIF_WIDTH_PX, yPx, variant), 255], (yPx * widthPx + xPx) * 4);
    }
  }

  return pixels;
}

export function createBillboardMotifTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    paintPlaceholderAtlas(),
    MOTIF_WIDTH_PX * BILLBOARD_VARIANTS,
    MOTIF_HEIGHT_PX,
  );

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  // No mipmaps: atlas cells would bleed into each other at a distance.
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return texture;
}
