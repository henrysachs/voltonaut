/**
 * Route biomes as a discriminated union (#75): each biome owns exactly the
 * decorations its kind names — no optional-field bags. The forest kind keeps
 * the original E3 visuals byte-identical for the established routes.
 */
export type Biome =
  | { readonly kind: "forest" }
  | { readonly kind: "coast" }
  | { readonly kind: "alpine" }
  | { readonly kind: "night-city" }
  | { readonly kind: "stone-age" };

/** Derives the biome from RouteData.scenery; unknown scenery keeps the forest. */
export function biomeFromScenery(scenery: string): Biome {
  switch (scenery) {
    case "coast":
      return { kind: "coast" };
    case "alpine":
      return { kind: "alpine" };
    case "night-city":
      return { kind: "night-city" };
    case "stone-age":
      return { kind: "stone-age" };
    default:
      return { kind: "forest" };
  }
}

/**
 * The forest and the coast keep their lake; the alpine pass, the night city (#75) and the stone
 * age valley (spec E10-15) drop it.
 */
export function biomeHasLake(biome: Biome): boolean {
  return biome.kind === "forest" || biome.kind === "coast";
}
