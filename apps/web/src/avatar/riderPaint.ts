import * as THREE from "three";

/**
 * Procedural textures painted texel by texel in plain JavaScript (no canvas), so they work in
 * the render worker and in unit tests alike and stay deterministic.
 */
export type Rgb = readonly [number, number, number];

export const TAU = Math.PI * 2;

export function rgb(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function cssRgb(css: string): Rgb {
  return rgb(new THREE.Color(css).getHex());
}

export function blend(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));

  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function shade(color: Rgb, factor: number): Rgb {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

/** Coverage of a shape from its signed distance (negative inside), soft over `widthM`. */
export function coverage(distance: number, width: number): number {
  return Math.min(1, Math.max(0, 0.5 - distance / width));
}

/** Paints a square texture; `paint` gets texel-centre (u, v) and returns an sRGB colour. */
export function paintTexture(
  size: number,
  paint: (u: number, v: number) => Rgb,
  height = size,
): THREE.DataTexture {
  const data = new Uint8Array(size * height * 4);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const [r, g, b] = paint((column + 0.5) / size, (row + 0.5) / height);
      const offset = (row * size + column) * 4;

      data[offset] = Math.round(r);
      data[offset + 1] = Math.round(g);
      data[offset + 2] = Math.round(b);
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, height, THREE.RGBAFormat);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return texture;
}

export function angleDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;

  return Math.min(d, TAU - d);
}
