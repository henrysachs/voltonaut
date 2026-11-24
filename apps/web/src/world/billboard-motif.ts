import * as THREE from "three";

/**
 * Placeholder motif until the sponsor artwork and its licence are delivered
 * (issue #42). It is painted procedurally, so it needs no asset file or
 * licence entry. Swapping in the real motif only replaces this texture.
 */
export const MOTIF_WIDTH_PX = 512;
export const MOTIF_HEIGHT_PX = 256;

const BORDER_PX = 12;

type Rgb = readonly [number, number, number];

export const MOTIF_BACKGROUND: Rgb = [0x25, 0x4c, 0x47];
export const MOTIF_BORDER: Rgb = [0xf3, 0xe7, 0xb8];
export const MOTIF_BOLT: Rgb = [0xff, 0xd2, 0x3f];

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

function colorAt(xPx: number, yPx: number, widthPx: number, heightPx: number): Rgb {
  if (
    xPx < BORDER_PX ||
    yPx < BORDER_PX ||
    xPx >= widthPx - BORDER_PX ||
    yPx >= heightPx - BORDER_PX
  ) {
    return MOTIF_BORDER;
  }

  const v = (yPx + 0.5) / heightPx;
  const u = 0.5 + ((xPx + 0.5) / widthPx - 0.5) * (widthPx / heightPx);

  return insideBolt(u, v) ? MOTIF_BOLT : MOTIF_BACKGROUND;
}

/** RGBA pixels, row 0 at the bottom (DataTexture convention). */
export function paintPlaceholderMotif(widthPx: number, heightPx: number): Uint8Array {
  const pixels = new Uint8Array(widthPx * heightPx * 4);

  for (let yPx = 0; yPx < heightPx; yPx += 1) {
    for (let xPx = 0; xPx < widthPx; xPx += 1) {
      const offset = (yPx * widthPx + xPx) * 4;

      pixels.set([...colorAt(xPx, yPx, widthPx, heightPx), 255], offset);
    }
  }

  return pixels;
}

export function createBillboardMotifTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    paintPlaceholderMotif(MOTIF_WIDTH_PX, MOTIF_HEIGHT_PX),
    MOTIF_WIDTH_PX,
    MOTIF_HEIGHT_PX,
  );

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
}
