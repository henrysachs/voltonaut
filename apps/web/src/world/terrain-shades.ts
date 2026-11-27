import * as THREE from "three";

/** Terrain vertex colors per biome (#75); the forest values are the original ones. */
export interface TerrainPalette {
  readonly low: number;
  readonly high: number;
  readonly shore: number;
  /** Colour of the alpine road apron. */
  readonly ground: number;
}

export const FOREST_TERRAIN: TerrainPalette = {
  low: 0x466848,
  high: 0x72925a,
  shore: 0xc9bb8a,
  ground: 0x59744d,
};

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function rgb(hex: number): Rgb {
  const color = new THREE.Color(hex);

  return { r: color.r, g: color.g, b: color.b };
}

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

export interface Shades {
  readonly low: Rgb;
  readonly high: Rgb;
  readonly shore: Rgb;
}

/** Shades of one palette, converted once. */
export function shadesOf(palette: TerrainPalette): Shades {
  return { low: rgb(palette.low), high: rgb(palette.high), shore: rgb(palette.shore) };
}

function weighted(shades: readonly Shades[], weights: readonly number[], key: keyof Shades): Rgb {
  return shades.reduce<Rgb>(
    (total, shade, index) => {
      const weight = weights[index] ?? 0;

      return {
        r: total.r + shade[key].r * weight,
        g: total.g + shade[key].g * weight,
        b: total.b + shade[key].b * weight,
      };
    },
    { r: 0, g: 0, b: 0 },
  );
}

/** Blends shades by weights that sum to 1; a full weight returns that region's shades as is. */
export function blendedShades(shades: readonly Shades[], weights: readonly number[]): Shades {
  const pick = shades[weights.indexOf(1)];

  if (pick !== undefined) return pick;

  return {
    low: weighted(shades, weights, "low"),
    high: weighted(shades, weights, "high"),
    shore: weighted(shades, weights, "shore"),
  };
}
